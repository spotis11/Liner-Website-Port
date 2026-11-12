/**
 * Animated-GIF detection shared by every surface that stores user images.
 *
 * Canvas re-encodes (drawImage -> toDataURL) capture only the first frame, so
 * animated GIFs must bypass them and be stored byte-for-byte to keep moving.
 * Consumers: custom playlist covers (IndexedDB blobs) and profile avatars
 * (data URLs through PATCH /api/auth/profile).
 */

/**
 * True when the blob is a GIF containing more than one frame. Scans for
 * Graphic Control Extension markers (0x21 0xF9) — one per frame; a static GIF
 * has at most one. Cheap byte scan, no decode, safe false-positive direction
 * (a misdetection just stores the original file, which still renders fine).
 */
export async function isAnimatedGif(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  const sig = String.fromCharCode(...head);
  if (sig !== "GIF87a" && sig !== "GIF89a") return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let extensions = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
      extensions++;
      if (extensions >= 2) return true;
    }
  }
  return false;
}
