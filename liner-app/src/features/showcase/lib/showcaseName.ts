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
