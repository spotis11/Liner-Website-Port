/**
 * The scramble itself: pure, testable helpers that turn the site name into
 * random letters. The Website Showcase mode re-rolls the name every few
 * milliseconds (see SHOWCASE_TICK_MS) so the whole site looks like it is
 * glitching out — dedicated to @jayzeyluna.
 */

/** Characters the scramble can pick from (letters only, both cases). */
const SCRAMBLE_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** How often the name re-rolls while the showcase mode is on. */
export const SHOWCASE_TICK_MS = 40;

/**
 * How often the address-bar query re-rolls. Browsers throttle history
 * writes (Safari hard-limits replaceState to 100 calls per 30 seconds),
 * so the URL junk changes ~2.5 times per second instead of every 40ms
 * like the tab title.
 */
export const SHOWCASE_URL_TICK_MS = 400;

/** Bounds for the random name length each tick. */
export const SHOWCASE_MIN_LENGTH = 5;
export const SHOWCASE_MAX_LENGTH = 9;

/** The real, boring, normal name of the website. */
export const REAL_SITE_NAME = "Liner";

/** The query parameter the showcase junk rides on ("?liner=<junk>"). */
export const SHOWCASE_URL_PARAM = "liner";

function randomInt(maxExclusive: number): number {
  // Math.random is plenty for a cosmetic glitch — no crypto needed.
  return Math.floor(Math.random() * maxExclusive);
}

/** One random letter from the pool. */
export function randomLetter(): string {
  return SCRAMBLE_POOL.charAt(randomInt(SCRAMBLE_POOL.length));
}

/** Characters usable in the URL junk (letters + digits, URL-safe). */
const URL_JUNK_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * A chunk of random URL junk for the address bar: 6–10 letters/digits.
 * Pure — call it as often as you like. It only ever rides in the
 * "?liner=" query parameter, which nothing in the app reads.
 */
export function randomUrlJunk(): string {
  const length = 6 + randomInt(5);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += URL_JUNK_POOL.charAt(randomInt(URL_JUNK_POOL.length));
  }
  return out;
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
