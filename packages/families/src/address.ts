/**
 * A family's DELIVERY address for funded gifts (Phase 6 slice 4b, user decision 2026-11-06:
 * "collect an address"). SERVER-ONLY. Callers: signed-in parent with the PIN unlocked.
 *
 * Data minimisation (kids are minors; COPPA spirit, and less to lose in a breach):
 *  - Asked for ONLY while a gift is funded and waiting to be delivered; refused otherwise.
 *  - Stored ENCRYPTED (AES-256-GCM, ADDRESS_ENCRYPTION_KEY, bound to the family id) and never
 *    loaded by ordinary queries (select: false).
 *  - Deleted automatically once no gift is waiting any more (@repo/wishlists/fulfilment), and the
 *    parent can delete it any time.
 *  - Audit rows say THAT it changed, never the address itself.
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { sealJson, unsealJson } from "@repo/auth/sealed";
import { AuditLog, Family, trusted, withTransaction } from "@repo/db";
import { deliveryAddressSchema, type DeliveryAddress } from "@repo/lib/address";
import { ADDRESS_KEY as KEY, clearAddress, familyAwaitingDelivery as awaitingDelivery } from "@repo/wishlists/delivery";

/** Dashboard prompt: a gift is on its way and no address is stored. No decryption, just presence. */
export async function addressMissing(parent: Parent): Promise<boolean> {
  const fid = await ownFamilyId(parent);
  if (!fid) return false;
  const [needed, has] = await Promise.all([awaitingDelivery(fid), Family.exists({ _id: fid, deliveryAddressEnc: trusted({ $exists: true }) })]);
  return needed && !has;
}

export type AddressState = { needed: boolean; saved: DeliveryAddress | null; updatedAt: Date | null; unreadable: boolean };

/** For the parent's own page (and the dashboard prompt). */
export async function addressState(parent: Parent): Promise<AddressState | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  const [needed, fam] = await Promise.all([
    awaitingDelivery(fid),
    Family.findById(fid).select("+deliveryAddressEnc deliveryAddressUpdatedAt").lean<{ deliveryAddressEnc?: string; deliveryAddressUpdatedAt?: Date }>(),
  ]);
  const saved = fam?.deliveryAddressEnc ? unsealJson<DeliveryAddress>(fam.deliveryAddressEnc, fid, KEY) : null;
  return { needed, saved, updatedAt: fam?.deliveryAddressUpdatedAt ?? null, unreadable: Boolean(fam?.deliveryAddressEnc) && !saved };
}

export type AddressResult = { ok: true } | { ok: false; error: "notFound" | "notNeeded" | "invalid"; field?: string };

export async function saveAddress(parent: Parent, raw: Record<string, unknown>): Promise<AddressResult> {
  const fid = await ownFamilyId(parent);
  if (!fid) return { ok: false, error: "notFound" };
  const parsed = deliveryAddressSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", field: String(parsed.error.issues[0]?.path[0] ?? "") };
  if (!(await awaitingDelivery(fid))) return { ok: false, error: "notNeeded" };
  const enc = sealJson(parsed.data, fid, KEY);
  await withTransaction(async (session) => {
    await Family.updateOne({ _id: fid }, { $set: { deliveryAddressEnc: enc, deliveryAddressUpdatedAt: new Date() } }, { session });
    await AuditLog.create([{ actorUserId: parent.id, action: "family.address_update", targetType: "family", targetId: fid, details: {} }], { session });
  });
  return { ok: true };
}

export async function deleteAddress(parent: Parent): Promise<AddressResult> {
  const fid = await ownFamilyId(parent);
  if (!fid) return { ok: false, error: "notFound" };
  await clearAddress(fid, "parent", parent.id);
  return { ok: true };
}
