/**
 * What Spirit O Santa owes a store for ONE received gift (Phase 6 slice 5). SERVER-ONLY.
 * = wholesaleCents(gift's cost snapshot, store's discount) (@repo/lib/store, the ONE formula; the
 * store app shows the same number). The cost snapshot is the retail price in cents (1 centipoint =
 * 1 retail cent), taken when the gift was added (prices can't change after the item window).
 * Returns null when the store has no discount on record (admin must set it before paying).
 */
import "server-only";
import { Store } from "@repo/db";
import { wholesaleCents } from "@repo/lib/store";

export async function owedForGift(storeId: unknown, costCentipoints: number): Promise<number | null> {
  const store = await Store.findById(String(storeId)).select("discountBps").lean<{ discountBps?: number | null }>();
  return typeof store?.discountBps === "number" ? wholesaleCents(costCentipoints, store.discountBps) : null;
}
