/**
 * Point arithmetic. SERVER-ONLY (see constants.ts for why and for unit definitions).
 *
 * Every function validates its input and throws on anything that isn't a safe,
 * non-negative integer. Bad numbers (NaN, 1.5 cents, negatives) should never reach the
 * ledger, so they fail loudly here.
 */
import "server-only";
import { CENTIPOINTS_PER_POINT, CENTS_PER_POINT } from "./constants.ts";

/** Throws unless `n` is a non-negative safe integer. Returns `n` for chaining. */
export function assertNonNegativeInt(n: number, label = "value"): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${n}`);
  }
  return n;
}

/**
 * Tip money → centipoints the child earns.
 * Rounds DOWN to the nearest centipoint so we never award value we didn't receive.
 * e.g. 500 cents ($5) → 333 centipoints (3.33 points); 150 cents → 100 (1 point).
 */
export function centsToCentipoints(cents: number): number {
  assertNonNegativeInt(cents, "cents");
  return Math.floor((cents * CENTIPOINTS_PER_POINT) / CENTS_PER_POINT);
}

/**
 * Centipoints → cents someone must pay to buy them (e.g. a parent "pay-up" covering an
 * item's funding gap). Rounds UP so the platform is never short by a fraction of a cent.
 * e.g. 333 centipoints → 500 cents; 1 centipoint → 2 cents.
 */
export function centipointsToCents(centipoints: number): number {
  assertNonNegativeInt(centipoints, "centipoints");
  return Math.ceil((centipoints * CENTS_PER_POINT) / CENTIPOINTS_PER_POINT);
}

/**
 * Store item price → its cost in centipoints.
 * Product rule (SpiritOfSanta.md): an item's point cost equals its retail price, so
 * $1 retail = 1 point and therefore 1 cent = 1 centipoint. The gap between this and the
 * $1.50 tip rate is the platform margin that covers the store payout.
 */
export function itemPriceCentsToCentipoints(priceCents: number): number {
  return assertNonNegativeInt(priceCents, "priceCents");
}
