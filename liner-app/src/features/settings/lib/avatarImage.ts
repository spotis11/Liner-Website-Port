// client-side avatar processing for profile pictures
//
// the Liner API has no image upload endpoint, but PATCH /v1/users/me accepts
// avatarUrl as a data URL (verified: round-trips fully, body limit ~500KB).
// we downscale + recompress locally so a photo stays far under that limit.

const AVATAR_MAX_EDGE = 256;
const AVATAR_INPUT_LIMIT_BYTES = 10 * 1024 * 1024;
// api rejects bodies over ~1MB with 413; keep a wide safety margin
const AVATAR_DATA_URL_LIMIT = 400_000;

export const AVATAR_ACCEPTED_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,image/avif";

export type AvatarProcessError =
  | "invalid_type"
  | "too_large"
  | "decode_failed";

export class AvatarProcessException extends Error {
  readonly reason: AvatarProcessError;

  constructor(reason: AvatarProcessError) {
    super(`avatar process failed: ${reason}`);
    this.name = "AvatarProcessException";
    this.reason = reason;
  }
}

export function isAcceptableAvatarFile(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  if (file.type === "image/svg+xml") return false; // scriptable vector, never needed for a 256px avatar
  if (file.size > AVATAR_INPUT_LIMIT_BYTES) return false;
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

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AvatarProcessException("invalid_type");
  }
  if (file.size > AVATAR_INPUT_LIMIT_BYTES) {
    throw new AvatarProcessException("too_large");
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
