// Liner web port: uploads a track artwork image to the Discord application
// asset store so the web Discord RPC can reference it as a numeric asset id.
//
// Why: gateway presences cannot use arbitrary external image URLs, and the
// external-assets registration endpoint is user-token-only. With a bot token
// (the common Liner RPC setup) the artwork must instead be uploaded as an
// application asset: presigned upload slot -> GCS PUT -> finalize. That flow
// needs the DiscordBot User-Agent, which browsers cannot send, so the SPA
// relays it through here. The token is forwarded per request, never stored.
//
// POST { token, appId, url, key } -> { asset_id }

import { NextRequest } from "next/server";
import {
  DISCORD_API,
  UPSTREAM_TIMEOUT_MS,
  discordAuthHeaders,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_KEY_LENGTH = 100;

function sanitizeKey(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, MAX_KEY_LENGTH);
  return cleaned || "cover";
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid image url");
  }
  if (parsed.protocol !== "https:") throw new Error("image url must be https");

  const res = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "image/*" },
  });
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
  const declared = (res.headers.get("content-type") || "").toLowerCase();
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");
  const bytes = new Uint8Array(buffer);
  const sniffed = sniffImageMime(bytes);
  if (!sniffed && !declared.startsWith("image/")) {
    throw new Error("url is not an image");
  }
  return { bytes, mime: sniffed || declared };
}

async function uploadDiscordAsset(
  scheme: "bot" | "user",
  token: string,
  appId: string,
  key: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string> {
  const headers = discordAuthHeaders(scheme, token);

  // 1. presigned upload slot
  const slotRes = await fetch(`${DISCORD_API}/applications/${appId}/assets/upload`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ filename: `${key}.png`, file_size: bytes.byteLength }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!slotRes.ok) {
    throw new Error(`asset slot failed (${slotRes.status})`);
  }
  const slot = (await slotRes.json()) as { upload_url?: string; upload_filename?: string };
  if (!slot.upload_url || !slot.upload_filename) {
    throw new Error("asset slot response incomplete");
  }

  // 2. upload bytes to the presigned GCS url
  const putRes = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: bytes,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!putRes.ok) throw new Error(`asset upload failed (${putRes.status})`);

  // 3. finalize the asset
  const finalRes = await fetch(`${DISCORD_API}/applications/${appId}/assets`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ upload_filename: slot.upload_filename, key }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!finalRes.ok) throw new Error(`asset finalize failed (${finalRes.status})`);
  const created = (await finalRes.json()) as { asset_id?: string };
  if (!created.asset_id) throw new Error("asset finalize response incomplete");
  return created.asset_id;
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: { token?: string; appId?: string; url?: string; key?: string; scheme?: string };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }
  const { token, appId, url, key } = payload;
  if (!token || !/^[\w.-]{50,}$/.test(token)) {
    return Response.json({ message: "Missing/invalid token" }, { status: 400 });
  }
  if (!appId || !/^[0-9]{17,19}$/.test(appId)) {
    return Response.json({ message: "Missing/invalid appId" }, { status: 400 });
  }
  if (!url || typeof url !== "string") {
    return Response.json({ message: "Missing image url" }, { status: 400 });
  }
  const safeKey = sanitizeKey(String(key ?? "cover"));

  try {
    const { bytes, mime } = await fetchImage(url);
    const scheme: "bot" | "user" = payload.scheme === "user" ? "user" : "bot";
    try {
      const assetId = await uploadDiscordAsset(scheme, token, appId, safeKey, mime, bytes);
      return Response.json({ asset_id: assetId, scheme });
    } catch {
      if (scheme === "bot") {
        // The token may be a user token — retry with user auth once
        const assetId = await uploadDiscordAsset("user", token, appId, safeKey, mime, bytes);
        return Response.json({ asset_id: assetId, scheme: "user" });
      }
      throw new Error("asset upload failed");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "asset upload failed";
    return Response.json({ message }, { status: 502 });
  }
}
