/**
 * Engagement maths for store dashboards (Phase 2 slice 5). PURE: no database, safe to unit-test.
 *
 * What a store sees per item (user decisions 2026-11-05):
 *  - views          item page opened by a family (counter on Item.stats.views)
 *  - onLists        kids who currently have the item on their list
 *  - fullyFunded    of those, how many are 100% funded (includes locked / shipped / delivered)
 *  - locked         of those, how many are locked in: the store WILL need to fulfil them
 *  - fundingPercent funded points ÷ cost across those lists (rounded DOWN: never shows 100%
 *                   before every list is fully funded)
 * Only totals. Stores never see which kids, families or towns (COPPA: share the minimum).
 */

/** Wish-list statuses that mean "the item is on a kid's list" (everything except removed). */
export const ON_LIST_STATUSES = ["active", "fully_funded", "locked", "unfunded", "shipped", "delivered"] as const;
/** Fully funded or further along. */
export const FUNDED_STATUSES = ["fully_funded", "locked", "shipped", "delivered"] as const;
/** Locked in (can't be removed): the store will fulfil these. */
export const LOCKED_STATUSES = ["locked", "shipped", "delivered"] as const;

export type WishListTotals = {
  onLists: number;
  fullyFunded: number;
  locked: number;
  /** Sums across the lists, in centipoints (integers). */
  fundedCentipoints: number;
  costCentipoints: number;
};

export const EMPTY_TOTALS: WishListTotals = { onLists: 0, fullyFunded: 0, locked: 0, fundedCentipoints: 0, costCentipoints: 0 };

/** 0–100, integer, rounded down. 0 when nothing is on any list. */
export function fundingPercent(t: Pick<WishListTotals, "fundedCentipoints" | "costCentipoints">): number {
  if (!(t.costCentipoints > 0) || !(t.fundedCentipoints > 0)) return 0;
  // Integer maths (both are integer centipoints): no float rounding surprises.
  return Math.min(100, Math.floor((t.fundedCentipoints * 100) / t.costCentipoints));
}

/** Add up several items' totals (the store-wide summary row). */
export function sumTotals(rows: Iterable<WishListTotals>): WishListTotals {
  const out = { ...EMPTY_TOTALS };
  for (const r of rows) {
    out.onLists += r.onLists;
    out.fullyFunded += r.fullyFunded;
    out.locked += r.locked;
    out.fundedCentipoints += r.fundedCentipoints;
    out.costCentipoints += r.costCentipoints;
  }
  return out;
}
