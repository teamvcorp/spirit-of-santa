/**
 * Delivery-address lifecycle rules (Phase 6 slice 4b). SERVER-ONLY. The ONE place for "is a gift
 * still on its way to this family?" and "delete the stored address", used by the parent service
 * (@repo/families/address), the admin step (fulfilment.ts) and the daily purge.
 */
import "server-only";
import { AuditLog, connectDb, Family, trusted, WishListItem } from "@repo/db";
import { AWAITING_DELIVERY } from "./rules.ts";

export const ADDRESS_KEY = "ADDRESS_ENCRYPTION_KEY" as const;

/**
 * "Deliver, then delete" contact (parent email + language) kept on a closing family: sealed with the address key
 * but a DIFFERENT associated-data label, so an address can never be decrypted as a contact or the other way round.
 */
export const deletionContactAad = (familyId: string) => `deletion-contact:${familyId}`;
export type DeletionContact = { email: string; locale: string };

/** Does this family have a funded gift still on its way? */
export async function familyAwaitingDelivery(familyId: string): Promise<boolean> {
  return Boolean(await WishListItem.exists({ familyId, status: trusted({ $in: [...AWAITING_DELIVERY] }) }));
}

/**
 * Delete a family's stored address, but ONLY if it hasn't changed since `seenUpdatedAt` (when given):
 * a parent saving a new address at the same moment wins over a cleanup (compare-and-set).
 * Audited without content. `actorUserId` = the parent/admin, or undefined for the daily system job.
 */
export async function clearAddress(familyId: string, why: "parent" | "delivered" | "purge", actorUserId?: string, seenUpdatedAt?: Date | null): Promise<boolean> {
  const filter = { _id: familyId, deliveryAddressEnc: trusted({ $exists: true }), ...(seenUpdatedAt ? { deliveryAddressUpdatedAt: seenUpdatedAt } : {}) };
  const res = await Family.updateOne(filter, { $unset: { deliveryAddressEnc: 1, deliveryAddressUpdatedAt: 1 } });
  if (res.modifiedCount !== 1) return false;
  await AuditLog.create({ ...(actorUserId ? { actorUserId } : {}), action: "family.address_delete", targetType: "family", targetId: familyId, details: { by: why } });
  return true;
}

/**
 * Daily safety net: delete every address no gift needs any more (all delivered, removed, dropped at
 * the close, or the child deleted). Two queries to find them, then one compare-and-set per family.
 */
export async function purgeUnneededAddresses(): Promise<number> {
  await connectDb();
  const busy = (await WishListItem.distinct("familyId", { status: trusted({ $in: [...AWAITING_DELIVERY] }) })) as unknown[];
  const stale = await Family.find({ deliveryAddressEnc: trusted({ $exists: true }), _id: trusted({ $nin: busy }) })
    .select("deliveryAddressUpdatedAt")
    .limit(5000)
    .lean<{ _id: unknown; deliveryAddressUpdatedAt?: Date | null }[]>();
  let purged = 0;
  for (const f of stale) {
    // Re-check right before deleting (a gift may have been funded since the distinct above).
    if (await familyAwaitingDelivery(String(f._id))) continue;
    if (await clearAddress(String(f._id), "purge", undefined, f.deliveryAddressUpdatedAt ?? null)) purged += 1;
  }
  return purged;
}
