import { runWorkerPool } from "@/shared/utils/workerPool";

export interface AudioDownloadOptions {
  contentLength?: number;
  signal?: AbortSignal;
  chunkSize?: number;
  concurrency?: number;
  /** called after each chunk/segment lands — total is undefined when unknown */
  onProgress?: (received: number, total?: number) => void;
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const MAX_CHUNK_ATTEMPTS = 2;

export function isGoogleVideoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
}

function withRange(url: string, start: number, end: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set("range", `${start}-${end}`);
  return parsed.toString();
}

async function fetchChunk(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const expected = end - start + 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(withRange(url, start, end), { signal });
      if (!response.ok)
        throw new Error(
          `chunk ${start}-${end} returned HTTP ${response.status}`,
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== expected)
        throw new Error(
          `chunk ${start}-${end} returned ${bytes.byteLength} of ${expected} bytes`,
        );
      return bytes;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function downloadInChunks(
  url: string,
  total: number,
  options: AudioDownloadOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const starts = Array.from(
    { length: Math.ceil(total / chunkSize) },
    (_, index) => index * chunkSize,
  );
  const output = new Uint8Array(total);
  let received = 0;
  await runWorkerPool(
    starts,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (start) => {
      const end = Math.min(start + chunkSize, total) - 1;
      const bytes = await fetchChunk(url, start, end, options.signal);
      output.set(bytes, start);
      received += bytes.byteLength;
      options.onProgress?.(received, total);
    },
  );
  return output;
}

async function downloadWhole(
  url: string,
  signal?: AbortSignal,
  onProgress?: (received: number, total?: number) => void,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const response = await fetch(url, { signal });
  if (!response.ok && response.status !== 206) return null;
  const totalBytes = Number(
    /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1],
  );
  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(totalBytes) && totalBytes > 0
    ? totalBytes
    : Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : undefined;

  // stream the body so callers get progress; fall back to arrayBuffer when
  // the runtime gives us no readable stream
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
    const output = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    if (Number.isFinite(totalBytes) && output.byteLength < totalBytes)
      return null;
    return output;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(totalBytes) && bytes.byteLength < totalBytes) return null;
  onProgress?.(bytes.byteLength, total);
  return bytes;
}

export async function downloadAudioBytes(
  url: string,
  options: AudioDownloadOptions = {},
): Promise<Uint8Array<ArrayBuffer> | null> {
  const total = options.contentLength;
  const bytes =
    total && total > 0 && isGoogleVideoUrl(url)
      ? await downloadInChunks(url, total, options)
      : await downloadWhole(url, options.signal, options.onProgress);
  return bytes && bytes.byteLength > 0 ? bytes : null;
}
