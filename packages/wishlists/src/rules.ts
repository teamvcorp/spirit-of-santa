/**
 * Wish-list rules shared by the engine (writes) and the family screens (hints). PURE: no DB,
 * safe to unit-test. The engine stays the authority: screens use these only to decide which
 * buttons to show, and every action re-checks inside its transaction.
 */
import { ITEM_LOCK_DAYS } from "@repo/lib/limits";

const DAY_MS = 86_400_000;

/** Statuses that count as "on the list" (item cap, no duplicates). */
export const ON_LIST = ["active", "fully_funded", "locked", "shipped", "delivered"] as const;

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
