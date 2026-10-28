// Liner web port: zero-dependency audio tag reader for the local library.
//
// Recreated from the shipped bundle (untracked source lost — worklog Task 26).
// Reads the first ≤10 MB of each file in-browser: ID3v2.2/2.3/2.4 (+v1
// fallback) for mp3, FLAC metadata blocks, MP4/M4A ilst atoms, LIST/INFO for
// wav — extracting title/artist/album/year/track number, embedded cover art
// and (where the container has it) duration. Files without tags fall back to
// "Artist - Title" filename parsing.

import type { LocalTrackMeta } from "./localMusicDb";

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".flac",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".wma",
  ".aiff",
  ".aif",
  ".alac",
  ".mp4",
];

export function isAudioFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function makeLocalFileId(
  name: string,
  size: number,
  lastModified: number,
): string {
  // djb2 over name::size::lastModified — stable across rescans of same file
  let hash = 5381;
  const key = `${name}::${size}::${lastModified}`;
  for (let index = 0; index < key.length; index++)
    hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0;
  return `local:${(hash >>> 0).toString(36)}`;
}

interface Reader {
  view: DataView;
  u8: Uint8Array;
}

function toReader(buffer: ArrayBuffer): Reader {
  return { view: new DataView(buffer), u8: new Uint8Array(buffer) };
}

function ascii(view: DataView, offset: number, length: number): string {
  if (offset < 0 || offset + length > view.byteLength) return "";
  let out = "";
  for (let index = 0; index < length; index++)
    out += String.fromCharCode(view.getUint8(offset + index));
  return out;
}

function asciiFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index++)
    out += String.fromCharCode(bytes[index]);
  return out;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    switch (encoding) {
      case 0:
        return new TextDecoder("iso-8859-1").decode(bytes);
      case 1:
        if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254)
          return new TextDecoder("utf-16le").decode(bytes.subarray(2));
        if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255)
          return new TextDecoder("utf-16be").decode(bytes.subarray(2));
        return new TextDecoder("utf-16le").decode(bytes);
      case 2:
        return new TextDecoder("utf-16be").decode(bytes);
      default:
        return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    return "";
  }
}

function clean(value: string): string | undefined {
  const trimmed = value.replace(/\0+$/g, "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function synchsafe(view: DataView, offset: number): number {
  return (
    (view.getUint8(offset) << 21) |
    (view.getUint8(offset + 1) << 14) |
    (view.getUint8(offset + 2) << 7) |
    view.getUint8(offset + 3)
  );
}

interface ParsedTags extends LocalTrackMeta {
  coverBlob?: Blob;
  [key: string]: string | number | Blob | undefined;
}

function parseId3Picture(
  bytes: Uint8Array,
  v2: boolean,
): Blob | undefined {
  try {
    let offset = 1;
    let mime = "image/jpeg";
    if (v2) {
      mime = `image/${asciiFromBytes(bytes.subarray(offset, offset + 3)).toLowerCase()}`;
      offset += 3;
    } else {
      const terminator = bytes.indexOf(0, offset);
      if (terminator === -1) return;
      const declared = asciiFromBytes(bytes.subarray(offset, terminator));
      if (declared) mime = declared;
      offset = terminator + 1;
    }
    offset += 1; // picture type
    const encoding = bytes[0];
    if (encoding === 1 || encoding === 2) {
      // utf-16 description, double-NUL terminated
      while (offset + 1 < bytes.length && (bytes[offset] !== 0 || bytes[offset + 1] !== 0))
        offset += 2;
      offset += 2;
    } else {
      while (offset < bytes.length && bytes[offset] !== 0) offset += 1;
      offset += 1;
    }
    if (offset >= bytes.length) return undefined;
    return new Blob([bytes.subarray(offset).slice()], {
      type: mime || "image/jpeg",
    });
  } catch {
    return undefined;
  }
}

function parseId3v2(reader: Reader, tags: ParsedTags): void {
  const { view, u8 } = reader;
  const major = view.getUint8(3);
  const flags = view.getUint8(5);
  const tagSize = synchsafe(view, 6);
  let offset = 10;
  const limit = Math.min(10 + tagSize, view.byteLength);
  if (flags & 64 && major >= 3) {
    const extSize = major === 4 ? synchsafe(view, offset) : view.getUint32(offset);
    offset += major === 4 ? extSize : extSize + 4;
  }
  const idLength = major === 2 ? 3 : 4;
  const frameMap =
    major === 2
      ? { TT2: "title", TP1: "artist", TAL: "album", TYE: "year" }
      : { TIT2: "title", TPE1: "artist", TALB: "album", TYER: "year", TDRC: "year" };
  while (offset + idLength + (major === 2 ? 3 : 6) <= limit) {
    const id = ascii(view, offset, idLength);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let size: number;
    if (major === 2) {
      size =
        (view.getUint8(offset + 3) << 16) |
        (view.getUint8(offset + 4) << 8) |
        view.getUint8(offset + 5);
      offset += 6;
    } else {
      size = major === 4 ? synchsafe(view, offset + 4) : view.getUint32(offset + 4);
      offset += 10;
    }
    if (size > limit - offset) break;
    if (size <= 0) break;
    const frame = u8.subarray(offset, offset + size);
    if (id === "APIC" || id === "PIC") {
      tags.coverBlob ??= parseId3Picture(frame, id === "PIC");
    } else if (id === "TRCK" || id === "TRK") {
      const raw = clean(decodeText(frame.subarray(1), frame[0])) ?? "";
      const number = Number.parseInt(raw.split("/")[0] ?? "", 10);
      if (Number.isFinite(number)) tags.trackNumber = number;
    } else {
      const mapped = frameMap[id as keyof typeof frameMap];
      if (mapped && !tags[mapped]) {
        const value = clean(decodeText(frame.subarray(1), frame[0]));
        if (value) tags[mapped] = value;
      }
    }
    offset += size;
  }
}

function parseId3v1(reader: Reader, tags: ParsedTags): void {
  const { u8 } = reader;
  if (u8.length < 128) return;
  const tail = u8.subarray(u8.length - 128);
  if (asciiFromBytes(tail.subarray(0, 3)) !== "TAG") return;
  const field = (offset: number, length: number) =>
    clean(decodeText(tail.subarray(offset, offset + length), 0));
  tags.title ??= field(3, 30);
  tags.artist ??= field(33, 30);
  tags.album ??= field(63, 30);
  tags.year ??= field(93, 4);
}

function parseVorbisComment(bytes: Uint8Array, tags: ParsedTags): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) return;
  let offset = 4 + view.getUint32(0, true);
  if (offset + 4 > bytes.length) return;
  const count = view.getUint32(offset, true);
  offset += 4;
  for (let index = 0; index < count && offset + 4 <= bytes.length; index++) {
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > bytes.length) break;
    const comment = new TextDecoder("utf-8").decode(
      bytes.subarray(offset, offset + length),
    );
    offset += length;
    const equals = comment.indexOf("=");
    if (equals === -1) continue;
    const key = comment.slice(0, equals).toUpperCase();
    const value = clean(comment.slice(equals + 1));
    if (!value) continue;
    if (key === "TITLE") tags.title ??= value;
    else if (key === "ARTIST" || key === "ALBUMARTIST") tags.artist ??= value;
    else if (key === "ALBUM") tags.album ??= value;
    else if (key === "DATE" || key === "YEAR") tags.year ??= value.slice(0, 4);
    else if (key === "TRACKNUMBER") {
      const number = Number.parseInt(value.split("/")[0] ?? "", 10);
      if (Number.isFinite(number)) tags.trackNumber ??= number;
    }
  }
}

function parseFlacPicture(bytes: Uint8Array, tags: ParsedTags): void {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;
    const mimeLength = view.getUint32(offset);
    offset += 4;
    const mime = new TextDecoder("utf-8").decode(
      bytes.subarray(offset, offset + mimeLength),
    );
    offset += mimeLength;
    const descriptionLength = view.getUint32(offset);
    offset += 4 + descriptionLength;
    offset += 16; // width/height/depth/colors
    const dataLength = view.getUint32(offset);
    offset += 4;
    if (offset + dataLength > bytes.length) return;
    tags.coverBlob = new Blob([bytes.subarray(offset, offset + dataLength).slice()], {
      type: mime || "image/jpeg",
    });
  } catch {
    // cover art is best-effort
  }
}

function parseFlac(reader: Reader, tags: ParsedTags): void {
  const { view, u8 } = reader;
  let offset = 4;
  while (offset + 4 <= view.byteLength) {
    const header = view.getUint8(offset);
    const last = !!(header & 128);
    const type = header & 127;
    const length =
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);
    const body = u8.subarray(offset + 4, offset + 4 + length);
    if (body.length < length) break;
    if (type === 0 && body.length >= 18) {
      // STREAMINFO: sample rate (20 bits) + total samples (36 bits)
      const info = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const sampleRate =
        (info.getUint8(10) << 12) |
        (info.getUint8(11) << 4) |
        (info.getUint8(12) >> 4);
      const totalSamples =
        (info.getUint8(13) & 15) * 2 ** 32 +
        info.getUint8(14) * 2 ** 24 +
        info.getUint8(15) * 2 ** 16 +
        info.getUint8(16) * 256 +
        info.getUint8(17);
      if (sampleRate > 0 && totalSamples > 0)
        tags.durationMs = Math.round((totalSamples / sampleRate) * 1000);
    } else if (type === 4) {
      parseVorbisComment(body, tags);
    } else if (type === 6 && !tags.coverBlob) {
      parseFlacPicture(body, tags);
    }
    offset += 4 + length;
    if (last) break;
  }
}

function parseMp4(reader: Reader, tags: ParsedTags): void {
  const { view, u8 } = reader;
  const asciiAt = (offset: number, length: number) => ascii(view, offset, length);

  // walk the atom tree looking for `path` inside [start, end)
  function findAtom(
    start: number,
    end: number,
    fourcc: string,
  ): [number, number] | null {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const name = asciiAt(offset + 4, 4);
      let headerSize = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) return null;
      if (name === fourcc) return [offset + headerSize, offset + size];
      offset += size;
    }
    return null;
  }

  const moov = findAtom(0, view.byteLength, "moov");
  if (!moov) return;
  const udta = findAtom(moov[0], moov[1], "udta");
  if (!udta) return;
  const meta = findAtom(udta[0], udta[1], "meta");
  if (!meta) return;
  // meta is a full box with a 4-byte version/flags header before children
  const ilst = findAtom(meta[0] + 4, meta[1], "ilst");
  if (!ilst) return;

  let item = ilst[0];
  while (item + 8 <= ilst[1]) {
    const size = view.getUint32(item);
    if (size < 8 || item + size > ilst[1]) break;
    const name = asciiAt(item + 4, 4);
    const data = findAtom(item + 8, item + size, "data");
    if (data) {
      const payload = u8.subarray(data[0] + 8, data[1]);
      const typeFlag = view.getUint32(data[0]);
      const text = () => clean(new TextDecoder("utf-8").decode(payload));
      if (name === "\u00a9nam") tags.title ??= text();
      else if (name === "\u00a9ART" || name === "aART") tags.artist ??= text();
      else if (name === "\u00a9alb") tags.album ??= text();
      else if (name === "\u00a9day") tags.year ??= text()?.slice(0, 4);
      else if (name === "trkn" && payload.length >= 4) {
        const number = (payload[2] << 8) | payload[3];
        if (number > 0) tags.trackNumber = number;
      } else if (name === "covr" && !tags.coverBlob) {
        const mime = (typeFlag & 0xffffff) === 14 ? "image/png" : "image/jpeg";
        tags.coverBlob = new Blob([payload.slice()], { type: mime });
      }
    }
    item += size;
  }

  const mvhd = findAtom(moov[0], moov[1], "mvhd");
  if (mvhd) {
    const version = view.getUint8(mvhd[0]);
    if (version === 0 && mvhd[0] + 16 <= mvhd[1]) {
      const timescale = view.getUint32(mvhd[0] + 12);
      const duration = view.getUint32(mvhd[0] + 16);
      if (timescale > 0)
        tags.durationMs = Math.round((duration / timescale) * 1000);
    } else if (version === 1 && mvhd[0] + 28 <= mvhd[1]) {
      const timescale = view.getUint32(mvhd[0] + 20);
      const duration = Number(view.getBigUint64(mvhd[0] + 24));
      if (timescale > 0)
        tags.durationMs = Math.round((duration / timescale) * 1000);
    }
  }
}

function parseWav(reader: Reader, tags: ParsedTags): void {
  const { view, u8 } = reader;
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") return;
  let offset = 12;
  let sampleRate = 0;
  let dataSize = 0;
  let byteRate = 0;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = u8.subarray(offset + 8, Math.min(offset + 8 + size, view.byteLength));
    if (id === "fmt " && body.length >= 16) {
      const fmt = new DataView(body.buffer, body.byteOffset, body.byteLength);
      sampleRate = fmt.getUint32(4, true);
      byteRate = fmt.getUint32(8, true);
    } else if (id === "data") {
      dataSize = size;
    } else if (id === "LIST" && asciiFromBytes(body.subarray(0, 4)) === "INFO") {
      let cursor = 4;
      while (cursor + 8 <= body.length) {
        const subId = asciiFromBytes(body.subarray(cursor, cursor + 4));
        const subSize = new DataView(
          body.buffer,
          body.byteOffset,
          body.byteLength,
        ).getUint32(cursor + 4, true);
        const value = clean(
          decodeText(
            body.subarray(cursor + 8, Math.min(cursor + 8 + subSize, body.length)),
            0,
          ),
        );
        if (value) {
          if (subId === "INAM") tags.title ??= value;
          else if (subId === "IART") tags.artist ??= value;
          else if (subId === "IPRD") tags.album ??= value;
          else if (subId === "ICRD") tags.year ??= value.slice(0, 4);
        }
        cursor += 8 + subSize + (subSize % 2);
      }
    }
    offset += 8 + size + (size % 2);
  }
  if (sampleRate > 0 && byteRate > 0 && dataSize > 0)
    tags.durationMs = Math.round((dataSize / byteRate) * 1000);
}

const TAG_HEADER_BYTES = 10 * 1024 * 1024;

export async function readAudioTags(file: File): Promise<ParsedTags> {
  const tags: ParsedTags = {};
  try {
    const sliceSize = Math.min(file.size, TAG_HEADER_BYTES);
    const reader = toReader(await file.slice(0, sliceSize).arrayBuffer());
    const magic = ascii(reader.view, 0, 4);
    if (magic === "fLaC") {
      parseFlac(reader, tags);
    } else if (magic === "RIFF") {
      parseWav(reader, tags);
    } else if (magic.startsWith("ID3")) {
      parseId3v2(reader, tags);
      const tailSize = file.size >= 128 ? 128 : file.size;
      if (!tags.title || !tags.artist)
        parseId3v1(
          toReader(await file.slice(file.size - tailSize).arrayBuffer()),
          tags,
        );
    } else if (ascii(reader.view, 4, 4) === "ftyp") {
      parseMp4(reader, tags);
    }
    if (!tags.title && !tags.artist && !tags.album && file.size >= 128) {
      parseId3v1(toReader(await file.slice(file.size - 128).arrayBuffer()), tags);
    }
  } catch {
    // tags are best-effort; filename parsing fills the gaps
  }
  return tags;
}

/** "01 - Artist - Title.mp3" / "Artist - Title.mp3" / "01 Title.mp3" / "Title.mp3" */
export function tagsFromFileName(name: string): ParsedTags {
  const base = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_/g, " ")
    .trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 3 && /^\d{1,3}$/.test(parts[0].trim()))
    return {
      trackNumber: Number.parseInt(parts[0], 10),
      artist: parts[1].trim(),
      title: parts.slice(2).join(" - ").trim(),
    };
  if (parts.length >= 2)
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  const leading = base.match(/^(\d{1,3})[\s.]+(.+)$/);
  if (leading)
    return {
      trackNumber: Number.parseInt(leading[1], 10),
      title: leading[2].trim(),
    };
  return { title: base };
}

/** duration via a throwaway <audio> element for containers without headers */
export function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(0);
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const finish = (ms: number) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(ms);
    };
    const timeout = setTimeout(() => finish(0), 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      const seconds = audio.duration;
      resolve(
        Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
      );
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      finish(0);
    };
    audio.src = url;
  });
}

export function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga") || lower.endsWith(".opus"))
    return "audio/ogg";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
  if (lower.endsWith(".wma")) return "audio/x-ms-wma";
  return "audio/mpeg";
}

export function mergeTags(
  tags: ParsedTags,
  fileName: string,
  durationMs: number,
): ParsedTags {
  const fromName = tagsFromFileName(fileName);
  return {
    title: tags.title || fromName.title || fileName,
    artist: tags.artist || fromName.artist || "Unknown artist",
    album: tags.album,
    year: tags.year,
    trackNumber: tags.trackNumber ?? fromName.trackNumber,
    durationMs: durationMs > 0 ? durationMs : (tags.durationMs && tags.durationMs > 0 ? tags.durationMs : 0),
  };
}
