import { DEFAULT_PRIMARY_API, isElectronContext } from "./baseUrl";

export type HumanCheckAction = "login" | "register";
export type HumanCheckMode = "off" | "optional" | "required";

export interface HumanCheckRequest {
  action: HumanCheckAction;
  mode: Exclude<HumanCheckMode, "off">;
}

export type HumanCheckPrompt = (
  request: HumanCheckRequest,
) => Promise<string | null>;

export class HumanCheckCancelledError extends Error {
  constructor() {
    super("The human check was closed.");
    this.name = "HumanCheckCancelledError";
  }
}

let prompt: HumanCheckPrompt | null = null;

export function setHumanCheckPrompt(next: HumanCheckPrompt | null): void {
  prompt = next;
}

export function humanCheckPageUrl(action: HumanCheckAction): string {
  // The Turnstile widget on this page is domain-locked to Liner's own
  // hostnames — anywhere else it dies with error 110200 ("domain not
  // authorized"), so a same-origin relay copy can never host it. The page
  // loads on Liner's origin directly: real browsers pass upstream's WAF
  // where datacenter clients get challenged, and the widget runs on an
  // authorized origin. The page answers over postMessage with a wildcard
  // targetOrigin — the web uses a TOP-LEVEL popup (see CheckWindow) because
  // a framed load sits behind the WAF's X-Frame-Options.
  return `${DEFAULT_PRIMARY_API}/v1/auth/verify?action=${action}`;
}

export function humanCheckOrigins(): string[] {
  const origins = new Set<string>([new URL(DEFAULT_PRIMARY_API).origin]);
  // older web bundles still frame the same-origin relay copy of the page
  if (typeof window !== "undefined") origins.add(window.location.origin);
  return [...origins];
}

// On the website port the widget cannot run inside a page frame: the frame
// loads upstream's page, but for most visitors upstream answers with a
// Cloudflare WAF challenge (403 — and challenge pages set X-Frame-Options:
// sameorigin, so the browser refuses to display the frame at all), and a
// WAF-passing frame would still hit the widget's domain lock (110200). The
// web therefore opens the page in a TOP-LEVEL popup (CheckWindow) where a
// Cloudflare interstitial is solvable; the desktop shell keeps the iframe
// (its UA clears the WAF and it hosts the page itself).
export function humanCheckFrameBlocked(): boolean {
  return typeof window !== "undefined" && !isElectronContext();
}

export function isHumanCheckMode(value: unknown): value is HumanCheckMode {
  return value === "off" || value === "optional" || value === "required";
}

// the user chose "Try without verification" — remember it for a short
// window so a following TURNSTILE_REQUIRED answer doesn't re-open the
// check dialog in a loop
let declinedUntil = 0;

export function markHumanCheckDeclined() {
  declinedUntil = Date.now() + 60_000;
}

export function isHumanCheckDeclined(): boolean {
  return Date.now() < declinedUntil;
}

export async function runHumanCheck(
  action: HumanCheckAction,
  mode: HumanCheckMode,
): Promise<string | undefined> {
  if (mode === "off") return undefined;
  const token = prompt ? await prompt({ action, mode }) : null;
  if (token === "") {
    // explicit "try without verification" — not a cancel
    markHumanCheckDeclined();
    return undefined;
  }
  if (token) return token;
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}
