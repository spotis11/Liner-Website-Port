import { DEFAULT_PRIMARY_API } from "./baseUrl";

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
  // authorized"), so a same-origin relay copy can never host it. The frame
  // loads the upstream page directly: real browsers pass upstream's WAF
  // where datacenter clients get challenged, and the widget runs on an
  // authorized origin. The page answers over postMessage with a wildcard
  // targetOrigin.
  return `${DEFAULT_PRIMARY_API}/v1/auth/verify?action=${action}`;
}

export function humanCheckOrigins(): string[] {
  const origins = new Set<string>([new URL(DEFAULT_PRIMARY_API).origin]);
  // older web bundles still frame the same-origin relay copy of the page
  if (typeof window !== "undefined") origins.add(window.location.origin);
  return [...origins];
}

export function isHumanCheckMode(value: unknown): value is HumanCheckMode {
  return value === "off" || value === "optional" || value === "required";
}

export async function runHumanCheck(
  action: HumanCheckAction,
  mode: HumanCheckMode,
): Promise<string | undefined> {
  if (mode === "off") return undefined;
  const token = prompt ? await prompt({ action, mode }) : null;
  if (token) return token;
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}
