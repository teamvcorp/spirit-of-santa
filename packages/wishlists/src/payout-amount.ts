/**
 * What Spirit O Santa owes a store for ONE received gift (Phase 6 slice 5). SERVER-ONLY.
 * = wholesaleCents(gift's cost snapshot, store's discount) (@repo/lib/store, the ONE formula; the
 * store app shows the same number). The cost snapshot is the retail price in cents (1 centipoint =
 * 1 retail cent), taken when the gift was added (prices can't change after the item window).
 * Returns null when the store has no discount on record (admin must set it before paying).
 */
import "server-only";
import { Store, type DbSession } from "@repo/db";
import { wholesaleCents } from "@repo/lib/store";

export async function owedForGift(storeId: unknown, costCentipoints: number, session?: DbSession): Promise<number | null> {
  const q = Store.findById(String(storeId)).select("discountBps");
  const store = await (session ? q.session(session) : q).lean<{ discountBps?: number | null }>();
  return owedAt(store?.discountBps, costCentipoints);
}

/** Same formula when the discount is already loaded (bulk fills). */
export function owedAt(discountBps: number | null | undefined, costCentipoints: number): number | null {
  return typeof discountBps === "number" ? wholesaleCents(costCentipoints, discountBps) : null;
}
