// client-side avatar processing for profile pictures
//
// the Liner API has no image upload endpoint, but PATCH /v1/users/me accepts
// avatarUrl as a data URL. we downscale + recompress locally so a photo stays
// far under the compact 400k-char cap. animated GIFs are the exception: the
// canvas re-encode below would flatten them to their first frame, so they are
// stored byte-for-byte instead — the same bypass custom playlist covers use.
// Liner Pro unlocks animated GIF avatars up to 30 MB (oversized data URLs are
// served back through GET /api/avatar/[id] instead of inlined into payloads).

import { isAnimatedGif } from "@/shared/lib/animatedGif";

const AVATAR_MAX_EDGE = 256;
const AVATAR_INPUT_LIMIT_BYTES = 10 * 1024 * 1024;
// Liner Pro: animated GIF avatars up to 30 MB file size. Base64 inflates that
// to ~41.94M chars; the 41.95M data-url cap admits exactly <= 30 MB files and
// matches the server-side cap in src/app/api/auth/profile/route.ts.
const AVATAR_PRO_GIF_INPUT_LIMIT_BYTES = 30 * 1024 * 1024;
const AVATAR_PRO_DATA_URL_LIMIT = 41_950_000;
// compact cap for everyone else; oversized animations fail loudly instead of
// being silently corrupted by the server's (shorter) slice
const AVATAR_DATA_URL_LIMIT = 400_000;

export interface AvatarProcessOptions {
  /** Liner Pro: animated GIF avatars up to 30 MB (vs ~290 KB for everyone). */
  isPro?: boolean;
}

export const AVATAR_ACCEPTED_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,image/avif";

export type AvatarProcessError =
  | "invalid_type"
  | "too_large"
  | "decode_failed"
  | "gif_too_large";

export class AvatarProcessException extends Error {
  readonly reason: AvatarProcessError;

  constructor(reason: AvatarProcessError) {
    super(`avatar process failed: ${reason}`);
    this.name = "AvatarProcessException";
    this.reason = reason;
  }
}

export function isAcceptableAvatarFile(
  file: File,
  opts?: AvatarProcessOptions,
): boolean {
  if (!file.type.startsWith("image/")) return false;
  if (file.type === "image/svg+xml") return false; // scriptable vector, never needed for a 256px avatar
  const isProGif = Boolean(opts?.isPro) && file.type === "image/gif";
  if (file.size > (isProGif ? AVATAR_PRO_GIF_INPUT_LIMIT_BYTES : AVATAR_INPUT_LIMIT_BYTES))
    return false;
  return true;
}

function fitInside(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function decodeViaImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

async function decodeToDrawable(
  file: File,
): Promise<{ draw: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        draw: bitmap,
        width: bitmap.width,
        height: bitmap.height,
      };
    } catch {
      // fall through to <img> decoding
    }
  }
  const img = await decodeViaImageElement(file);
  return { draw: img, width: img.naturalWidth, height: img.naturalHeight };
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  // webp keeps transparency and is tiny; older engines silently fall back to png
  let dataUrl = canvas.toDataURL("image/webp", 0.85);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  }
  if (dataUrl.length > AVATAR_DATA_URL_LIMIT) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  }
  return dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

export async function fileToAvatarDataUrl(
  file: File,
  opts?: AvatarProcessOptions,
): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AvatarProcessException("invalid_type");
  }

  // Input size gate first (before any base64 conversion — a 30 MB file must
  // not be inflated to ~42M chars just to be rejected). Static images are
  // downscaled to a tiny webp anyway, so the 10 MB cap only ever bites huge
  // animated GIFs.
  const isProGif = Boolean(opts?.isPro) && file.type === "image/gif";
  const maxInputBytes = isProGif
    ? AVATAR_PRO_GIF_INPUT_LIMIT_BYTES
    : AVATAR_INPUT_LIMIT_BYTES;
  if (file.size > maxInputBytes) {
    throw new AvatarProcessException("too_large");
  }

  // animated GIFs skip the canvas entirely: createImageBitmap decodes only
  // frame 1, so re-encoding would freeze the animation. They are returned as
  // a raw data URL instead. The server rejects avatarUrl values over the
  // caller's cap (400k chars, or 41.95M for Liner Pro) with 413 — a longer
  // value would be corrupted, so an oversized animation fails loudly with
  // gif_too_large instead of quietly saving a broken image.
  if (file.type === "image/gif") {
    try {
      if (await isAnimatedGif(file)) {
        const gifDataUrl = await blobToDataUrl(file);
        const gifCap = opts?.isPro
          ? AVATAR_PRO_DATA_URL_LIMIT
          : AVATAR_DATA_URL_LIMIT;
        if (gifDataUrl.length > gifCap) {
          throw new AvatarProcessException("gif_too_large");
        }
        return gifDataUrl;
      }
    } catch (error) {
      if (error instanceof AvatarProcessException) throw error;
      throw new AvatarProcessException("decode_failed");
    }
  }

  let source: { draw: CanvasImageSource; width: number; height: number };
  try {
    source = await decodeToDrawable(file);
  } catch {
    throw new AvatarProcessException("decode_failed");
  }
  if (!source.width || !source.height) {
    throw new AvatarProcessException("decode_failed");
  }

  const { width, height } = fitInside(
    source.width,
    source.height,
    AVATAR_MAX_EDGE,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarProcessException("decode_failed");
  ctx.drawImage(source.draw, 0, 0, width, height);
  if ("close" in source.draw && typeof source.draw.close === "function") {
    source.draw.close();
  }

  const dataUrl = canvasToDataUrl(canvas);
  if (!dataUrl.startsWith("data:image/")) {
    throw new AvatarProcessException("decode_failed");
  }
  return dataUrl;
}
