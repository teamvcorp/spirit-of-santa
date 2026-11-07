/**
 * Store rules shared by the store app, admin app and server. CLIENT-SAFE (the UI shows
 * wholesale estimates and category lists), but the SERVER recomputes and enforces all of it.
 */

/**
 * Store categories. Fixed keys (translated in messages as StoreCategories.<key>) so search
 * and filtering stay consistent across languages. "other" covers everything else.
 */
export const STORE_CATEGORIES = [
  "toys",
  "books",
  "games",
  "sports",
  "arts_crafts",
  "clothing",
  "music",
  "electronics",
  "outdoors",
  "other",
] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export function isStoreCategory(v: unknown): v is StoreCategory {
  return typeof v === "string" && (STORE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Store statuses whose owner/reps may change the profile, photos, reps and items.
 * "rejected"/"suspended" stores are read-only; "invited" stores have no owner yet.
 * ONE list for every gate (service layer and dashboard UI) so they can't drift apart.
 */
export const EDITABLE_STORE_STATUSES = ["pending", "approved"] as const;

export function isStoreEditable(status: string): boolean {
  return (EDITABLE_STORE_STATUSES as readonly string[]).includes(status);
}

/**
 * Version of the store discount + guarantee agreement text (StoreAgreement messages).
 * Bump this whenever the wording changes; each store records the version it accepted.
 */
// History: 2026-11-05 (first) · 2026-11-07 (year-round: gifts held to December, ship by Dec 10, discount at receipt, Q1 catalogue).
export const STORE_AGREEMENT_VERSION = "2026-11-07";

/**
 * Discounts are integer BASIS POINTS (1 bp = 0.01%): 2000 = 20%, 1750 = 17.5%.
 * Integers avoid float rounding surprises in money maths (same reason prices are cents).
 * Agreed per store by an admin at approval (user decision 2026-11-05).
 */
export const MAX_DISCOUNT_BPS = 9000; // 90%: a typo guard, not a business target

/**
 * What Spirit of Santa owes the store for one item = retail minus the store's discount.
 * The store bills us this; we keep the difference (platform margin).
 * Rounded to the nearest cent (half up); both parties see the same number on screen.
 */
export function wholesaleCents(priceCents: number, discountBps: number): number {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new RangeError("priceCents");
  if (!Number.isSafeInteger(discountBps) || discountBps < 0 || discountBps > MAX_DISCOUNT_BPS) {
    throw new RangeError("discountBps");
  }
  return Math.round((priceCents * (10_000 - discountBps)) / 10_000);
}

/** "20%" / "17.5%" for display. */
export function formatDiscount(discountBps: number): string {
  return `${(discountBps / 100).toString()}%`;
}
