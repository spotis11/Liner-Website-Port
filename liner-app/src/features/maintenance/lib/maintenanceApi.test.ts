import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MaintenanceError,
  fetchMaintenanceStatus,
  setMaintenanceRemote,
} from "./maintenanceApi";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMaintenanceStatus", () => {
  it("parses the public probe answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          enabled: true,
          reasons: ["Sign-in is temporarily unavailable"],
          updatedAt: "2026-11-02T06:30:00.000Z",
        }),
      ),
    );
    const status = await fetchMaintenanceStatus();
    expect(status.enabled).toBe(true);
    expect(status.reasons).toEqual(["Sign-in is temporarily unavailable"]);
  });

  it("throws a generic error on non-200 answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(fetchMaintenanceStatus()).rejects.toBeInstanceOf(MaintenanceError);
  });
});

describe("setMaintenanceRemote", () => {
  it("posts enabled + reasons with the bearer token", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("POST");
      expect(headers.get("authorization")).toBe("Bearer tok");
      expect(String(init?.body)).toContain('"enabled":true');
      expect(String(init?.body)).toContain("upgrading");
      return jsonResponse({ enabled: true, reasons: ["We're upgrading"], updatedAt: "x" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const status = await setMaintenanceRemote(true, ["We're upgrading"], "tok");
    expect(status.enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after refreshing a dead session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ enabled: false, reasons: [], updatedAt: "x" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/shared/api/auth-session", () => ({
      refreshAuthSession: async () => ({ accessToken: "fresh" }),
    }));
    // import the module fresh so the mock above applies
    const { setMaintenanceRemote: setWithMockedRefresh } = await import(
      "./maintenanceApi"
    );
    const status = await setWithMockedRefresh(false, undefined, "stale");
    expect(status.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.doUnmock("@/shared/api/auth-session");
  });
});
