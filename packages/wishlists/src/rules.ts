/**
 * Wish-list rules shared by the engine (writes) and the family screens (hints). PURE: no DB,
 * safe to unit-test. The engine stays the authority: screens use these only to decide which
 * buttons to show, and every action re-checks inside its transaction.
 */
import { ITEM_LOCK_DAYS } from "@repo/lib/limits";
import { DAY_MS } from "@repo/lib/time";

/** Does a row with this status count toward the cap? */
export const countsTowardCap = (status: string) => (CAP_STATUSES as readonly string[]).includes(status);

/**
 * Statuses that count toward the kid's item CAP (and block adding the same gift twice).
 * NOT the same list as ON_LIST_STATUSES in @repo/stores/engagement-math (store dashboard totals,
 * which also count "unfunded"): "unfunded" only exists after Dec 25, when nothing can be added.
 */
export const CAP_STATUSES = ["active", "fully_funded", "locked", "shipped", "delivered"] as const;

/** When a fully funded item locks (30 days after full funding), or null if not funded yet. */
export function lockAt(fullyFundedAt: Date | null | undefined): Date | null {
  return fullyFundedAt ? new Date(new Date(fullyFundedAt).getTime() + ITEM_LOCK_DAYS * DAY_MS) : null;
}

/**
 * May a parent remove this item now? Only active / fully funded items, and a fully funded one
 * only before its 30-day lock date (checked by DATE, so a late daily lock job can't open a gap).
 * The season must be open as well: the caller checks that.
 */
export function isRemovable(status: string, fullyFundedAt: Date | null | undefined, now = new Date()): boolean {
  if (status === "active") return true;
  if (status !== "fully_funded") return false;
  const lock = lockAt(fullyFundedAt);
  return !lock || lock.getTime() > now.getTime();
}
