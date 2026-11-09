/**
 * Wish-list rules shared by the engine (writes) and the family screens (hints). PURE: no DB,
 * safe to unit-test. The engine stays the authority: screens use these only to decide which
 * buttons to show, and every action re-checks inside its transaction.
 */
/** Does a row with this status count toward the cap? */
export const countsTowardCap = (status: string) => (CAP_STATUSES as readonly string[]).includes(status);

/**
 * Statuses that count toward the kid's item CAP (and block adding the same gift twice).
 * NOT the same list as ON_LIST_STATUSES in @repo/stores/engagement-math (store dashboard totals,
 * which also count "unfunded"): "unfunded" only exists after Dec 25, when nothing can be added.
 */
export const CAP_STATUSES = ["active", "fully_funded", "locked", "shipped", "delivered"] as const;

/**
 * May a parent remove this item now? Only while it's still collecting magic ("active").
 * Fully funded = SECURED (owner 2026-11-07): it can't be undone, even before the daily job locks it,
 * so the check is on STATUS alone and a late lock job never opens a gap.
 * The season must be open as well: the caller checks that.
 */
export const isRemovable = (status: string): boolean => status === "active";

/**
 * Gifts still on their way to a family (funded, not yet delivered). While a family has any, it
 * may keep a delivery address; once none are left the address is deleted (slice 4b).
 */
export const AWAITING_DELIVERY = ["fully_funded", "locked", "shipped"] as const;

/** The parts of a wish-list row that would give a surprise away. */
type Revealing = { surprise: boolean; itemId: string; name: string; storeName: string; photoUrl?: string; viewable: boolean };

/**
 * Hide a SURPRISE gift's identity (owner 2026-11-08: the child sees only a wrapped gift). Applied on the SERVER before
 * a row reaches any page the child can open, so the item's name, photo, store and id are never in the HTML or the
 * React payload. Not a surprise → returned unchanged. Only parent-PIN pages ask for the real row (reveal).
 */
export function maskSurprise<T extends Revealing>(row: T): T {
  if (!row.surprise) return row;
  return { ...row, itemId: "", name: "", storeName: "", photoUrl: undefined, viewable: false };
}
