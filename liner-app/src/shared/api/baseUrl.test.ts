import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRIMARY_API,
  isSecureBaseUrl,
  resolveApiBaseUrl,
  SAME_ORIGIN_API,
} from "./baseUrl";

type WinExtra = Record<string, unknown>;

function withElectron(value: unknown): () => void {
  const had = Object.prototype.hasOwnProperty.call(window, "linerElectron");
  (window as unknown as WinExtra).linerElectron = value;
  return () => {
    if (had) {
      (window as unknown as WinExtra).linerElectron = undefined;
    } else {
      delete (window as unknown as WinExtra).linerElectron;
    }
  };
}

afterEach(() => {
  delete (window as unknown as WinExtra).linerElectron;
});

describe("api base url", () => {
  it("defaults to same-origin in the browser (website build)", () => {
    // jsdom window without the electron bridge -> website context
    expect(resolveApiBaseUrl(undefined)).toBe(SAME_ORIGIN_API);
    expect(resolveApiBaseUrl("  ")).toBe(SAME_ORIGIN_API);
    expect(resolveApiBaseUrl("not a url")).toBe(SAME_ORIGIN_API);
  });

  it("defaults to the upstream api inside electron", () => {
    const restore = withElectron({});
    try {
      expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_PRIMARY_API);
      expect(resolveApiBaseUrl("not a url")).toBe(DEFAULT_PRIMARY_API);
    } finally {
      restore();
    }
  });

  it("accepts an https override and trims trailing slashes", () => {
    expect(resolveApiBaseUrl("https://staging.example.com/")).toBe(
      "https://staging.example.com",
    );
  });

  it("accepts plain http only to loopback", () => {
    for (const url of [
      "http://localhost:1337",
      "http://127.0.0.1:1337",
      "http://[::1]:1337",
    ]) {
      expect(isSecureBaseUrl(url)).toBe(true);
      expect(resolveApiBaseUrl(url)).toBe(url);
    }
  });

  it("refuses plain http to a remote host", () => {
    const restore = withElectron({});
    try {
      expect(resolveApiBaseUrl("http://edge.tryliner.fun:10518")).toBe(
        DEFAULT_PRIMARY_API,
      );
    } finally {
      restore();
    }
  });
});
