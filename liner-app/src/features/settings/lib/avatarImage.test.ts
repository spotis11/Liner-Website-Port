import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  AvatarProcessException,
  fileToAvatarDataUrl,
  isAcceptableAvatarFile,
} from "./avatarImage";

function makeFile(
  parts: BlobPart[],
  type: string,
  name = "avatar.png",
): File {
  return new File(parts, name, { type });
}

function stubCanvas(dataUrl: string) {
  const proto = Object.getPrototypeOf(document.createElement("canvas")) as
    HTMLCanvasElement;
  const drawImage = vi.fn();
  const toDataURL = vi.fn(() => dataUrl);
  const getContext = vi.fn(() => ({ drawImage }));
  vi.spyOn(proto, "getContext").mockImplementation(
    getContext as unknown as typeof proto.getContext,
  );
  vi.spyOn(proto, "toDataURL").mockImplementation(
    toDataURL as unknown as typeof proto.toDataURL,
  );
  return { drawImage, toDataURL, getContext };
}

describe("isAcceptableAvatarFile", () => {
  it("accepts common raster images", () => {
    expect(isAcceptableAvatarFile(makeFile([], "image/png"))).toBe(true);
    expect(isAcceptableAvatarFile(makeFile([], "image/jpeg"))).toBe(true);
    expect(isAcceptableAvatarFile(makeFile([], "image/webp"))).toBe(true);
    expect(isAcceptableAvatarFile(makeFile([], "image/gif"))).toBe(true);
  });

  it("rejects non-images, svg and oversized files", () => {
    expect(isAcceptableAvatarFile(makeFile([], "text/plain"))).toBe(false);
    expect(isAcceptableAvatarFile(makeFile([], "image/svg+xml"))).toBe(false);
    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    expect(isAcceptableAvatarFile(big)).toBe(false);
  });
});

describe("fileToAvatarDataUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects non-image files with invalid_type", async () => {
    await expect(
      fileToAvatarDataUrl(makeFile([], "application/pdf")),
    ).rejects.toMatchObject({ reason: "invalid_type" });
  });

  it("rejects svg uploads", async () => {
    await expect(
      fileToAvatarDataUrl(makeFile([], "image/svg+xml")),
    ).rejects.toMatchObject({ reason: "invalid_type" });
  });

  it("rejects oversized files with too_large", async () => {
    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    await expect(fileToAvatarDataUrl(big)).rejects.toMatchObject({
      reason: "too_large",
    });
  });

  it("downscales and returns the encoded data url", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 1024,
        height: 512,
        close: vi.fn(),
      })),
    );
    const stub = stubCanvas("data:image/webp;base64,abc");
    const dataUrl = await fileToAvatarDataUrl(
      makeFile([new ArrayBuffer(100)], "image/png"),
    );
    expect(dataUrl).toBe("data:image/webp;base64,abc");
    expect(stub.drawImage).toHaveBeenCalledTimes(1);
    expect(stub.getContext).toHaveBeenCalledWith("2d");
  });

  it("falls back to jpeg when the engine cannot encode webp", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 64,
        height: 64,
        close: vi.fn(),
      })),
    );
    const proto = Object.getPrototypeOf(document.createElement("canvas")) as HTMLCanvasElement;
    const toDataURL = vi
      .fn()
      .mockImplementation((type: string) =>
        type === "image/webp"
          ? "data:image/png;base64,fallback" // engines that can't webp return png
          : "data:image/jpeg;base64,jpegdata",
      );
    vi.spyOn(proto, "getContext").mockImplementation(
      (() => ({ drawImage: vi.fn() })) as unknown as typeof proto.getContext,
    );
    vi.spyOn(proto, "toDataURL").mockImplementation(
      toDataURL as unknown as typeof proto.toDataURL,
    );
    const dataUrl = await fileToAvatarDataUrl(
      makeFile([new ArrayBuffer(100)], "image/png"),
    );
    expect(dataUrl).toBe("data:image/jpeg;base64,jpegdata");
  });

  it("wraps decode failures as decode_failed", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("nope");
      }),
    );
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 0;
        naturalHeight = 0;
        set src(_: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(
      fileToAvatarDataUrl(makeFile([new ArrayBuffer(10)], "image/png")),
    ).rejects.toMatchObject({ reason: "decode_failed" });
  });

  it("is an Error subclass", () => {
    const err = new AvatarProcessException("too_large");
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe("too_large");
  });
});

describe("fileToAvatarDataUrl — animated GIFs", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Minimal GIF file: "GIF89a" + one Graphic Control Extension (0x21 0xF9)
   *  block per frame + zero padding + trailer. Two GCEs = animated. */
  function gifFile(frames: number, padBytes = 0): File {
    const bytes: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
    for (let i = 0; i < frames; i++) {
      bytes.push(0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00);
    }
    for (let i = 0; i < padBytes; i++) bytes.push(0x00);
    bytes.push(0x3b);
    return new File([new Uint8Array(bytes)], "avatar.gif", {
      type: "image/gif",
    });
  }

  it("stores animated GIFs byte-for-byte, skipping the canvas re-encode", async () => {
    const stub = stubCanvas("data:image/webp;base64,SHOULD_NOT_BE_USED");
    const file = gifFile(2);
    const dataUrl = await fileToAvatarDataUrl(file);

    expect(dataUrl.startsWith("data:image/gif;base64,")).toBe(true);
    // round-trip: the data URL decodes to the exact original bytes
    const decoded = atob(dataUrl.slice("data:image/gif;base64,".length));
    const original = new Uint8Array(await file.arrayBuffer());
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded.charCodeAt(i)).toBe(original[i]);
    }
    expect(stub.getContext).not.toHaveBeenCalled();
    expect(stub.drawImage).not.toHaveBeenCalled();
  });

  it("rejects animated GIFs whose data url would exceed the server slice limit", async () => {
    // 320 KB of GIF bytes -> ~427 KB of base64 -> over AVATAR_DATA_URL_LIMIT
    const file = gifFile(2, 320 * 1024);
    await expect(fileToAvatarDataUrl(file)).rejects.toMatchObject({
      reason: "gif_too_large",
    });
  });

  it("still downscales static GIFs through the canvas path", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 64,
        height: 64,
        close: vi.fn(),
      })),
    );
    const stub = stubCanvas("data:image/webp;base64,static");
    const dataUrl = await fileToAvatarDataUrl(gifFile(1));
    expect(dataUrl).toBe("data:image/webp;base64,static");
    expect(stub.drawImage).toHaveBeenCalledTimes(1);
  });
});
