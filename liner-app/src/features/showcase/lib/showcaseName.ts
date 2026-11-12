/**
 * The scramble itself: pure, testable helpers for the Website Showcase
 * mode — random site names for the glitching tab title/wordmark, plus the
 * address-bar cover that sweeps the URL down to the bare domain. The mode
 * re-rolls the name every few milliseconds (see SHOWCASE_TICK_MS) so the
 * whole site looks like it is glitching out — dedicated to @jayzeyluna.
 */

/** Characters the scramble can pick from (letters only, both cases). */
const SCRAMBLE_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** How often the name re-rolls while the showcase mode is on. */
export const SHOWCASE_TICK_MS = 40;

/**
 * How often the cover re-asserts itself. The router's own navigation is
 * covered on the spot via the router location + popstate/hashchange
 * listeners; this interval is only the backstop for any other writer.
 * Browsers throttle history writes (Safari hard-limits replaceState to
 * 100 calls per 30 seconds), so 400ms keeps the page comfortably inside
 * that budget.
 */
export const SHOWCASE_COVER_TICK_MS = 400;

/** Bounds for the random name length each tick. */
export const SHOWCASE_MIN_LENGTH = 5;
export const SHOWCASE_MAX_LENGTH = 9;

/** The real, boring, normal name of the website. */
export const REAL_SITE_NAME = "Liner";

function randomInt(maxExclusive: number): number {
  // Math.random is plenty for a cosmetic glitch — no crypto needed.
  return Math.floor(Math.random() * maxExclusive);
}

/** One random letter from the pool. */
export function randomLetter(): string {
  return SCRAMBLE_POOL.charAt(randomInt(SCRAMBLE_POOL.length));
}

/**
 * The URL the address bar is covered with while the showcase mode is on:
 * the bare domain root. The website serves the SPA at "/" (next.config
 * rewrites it to /liner/index.html), so a refresh on the covered URL boots
 * the app normally — and the bar shows nothing but the domain.
 */
export const SHOWCASE_COVER_PATH = "/";

/**
 * Does the address bar currently show anything a visitor could read?
 * The app is a HashRouter SPA served at the root, so the readable part is
 * the query string plus the #/route fragment. Pure — call it as often as
 * you like.
 */
export function shouldCoverUrl(
  pathname: string,
  search: string,
  hash: string,
): boolean {
  return pathname !== SHOWCASE_COVER_PATH || search !== "" || hash !== "";
}

/**
 * The real URL that belongs to a router location, used to hand the address
 * bar back when the showcase mode is switched off. The SPA routes live in
 * the URL fragment ("/library" → "/#/library"); the root view is the bare
 * path. Pure.
 */
export function realHrefForLocation(pathname: string, search: string): string {
  if (pathname === "/" && search === "") return SHOWCASE_COVER_PATH;
  return `/#${pathname}${search}`;
}

/**
 * A whole random site name: 5–9 random letters, re-rolled every call.
 * Pure in the sense that it touches nothing global — call it as often as
 * you like.
 */
export function randomSiteName(): string {
  const length =
    SHOWCASE_MIN_LENGTH + randomInt(SHOWCASE_MAX_LENGTH - SHOWCASE_MIN_LENGTH + 1);
  let out = "";
  for (let i = 0; i < length; i += 1) out += randomLetter();
  return out;
}
