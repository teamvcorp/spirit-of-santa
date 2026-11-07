/**
 * Deleting a child or a whole family (COPPA deletion right, Phase 8 slice 2a). SERVER-ONLY.
 *
 * Owner decision (2026-11-06): personal data goes NOW; the child's Christmas Magic goes to Spirit of Santa
 * (ledger "forfeit", like unfunded gifts at Dec 25); money records stay, anonymised.
 *
 * What happens to each kind of record (teaching note: deletion is a DESIGN, not a deleteMany):
 *  - Gifts not yet locked (active / fully_funded): released through the wish-list engine's ONE release path
 *    (releaseGiftInSession: escrow back, store's set-aside unit back to stock), then all the child's magic is
 *    forfeited to Spirit of Santa in one ledger row.
 *  - Gifts locked / shipped / delivered: a store is involved and is owed money, so the row STAYS (payouts read
 *    it) with familyDeletedAt set; the admin queue then says "keep for Spirit of Santa" instead of shipping.
 *  - Finished history rows (removed / unfunded): deleted.
 *  - Deeds (may hold free text), votes, the child: deleted. Live "pay later" text links for the deeds are
 *    switched off at Stripe first (the visitor's own consent record stays: it's theirs, 13-month rule).
 *  - Ledger (append-only) and Payment rows: kept; their kidId/familyId now point at nothing (anonymised).
 *  - Family (name, alias, address, PIN, consent record) and the parent's User + their email tokens: deleted.
 *  - AuditLog: kept (ids only, never names); one "kid.delete" / "family.delete" row records the deletion.
 * Tips arriving later for a deleted child are never credited: the webhook flags them for admin review.
 */
import "server-only";
import { ActionToken, AuditLog, connectDb, Deed, ensureLock, Family, Kid, KidVote, takeLock, Transaction, trusted, User, WishListItem, withTransaction, type DbSession } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { getSeasonYear } from "@repo/lib/season";
import { sendEmail } from "@repo/email";
import { closePayLaterForDeed } from "@repo/payments/pay-later-links";
import { familyAppOrigin } from "@repo/stores/urls";
import { releaseGiftInSession, type ReleasableGift } from "@repo/wishlists/engine";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";

export type EraseKidResult = { ok: true } | { ok: false; error: "notFound" };

/** Same lock name deed creation uses (packages/deeds/src/deeds.ts): no deed can be added mid-deletion. */
const deedLock = (kidId: string) => `kid-deeds:${kidId}`;

/** Before the transaction: switch off live "pay later" links of this child's deeds (Stripe call, can't roll back). */
async function closeKidPayLater(kidId: string): Promise<void> {
  const deeds = await Deed.find({ kidId, payLaterExpiresAt: trusted({ $ne: null }) }).select("_id").lean();
  for (const d of deeds) await closePayLaterForDeed(String(d._id));
}

/**
 * Erase ONE child inside the caller's transaction. Idempotent per child (the forfeit has a unique key), and
 * every step is compare-and-set, so a concurrent change (a tip landing) aborts and the transaction retries.
 */
async function eraseKidInSession(kidId: string, familyId: string, actorUserId: string, session: DbSession, now: Date): Promise<boolean> {
  await takeLock(deedLock(kidId), session);
  const kid = await Kid.findOne({ _id: kidId, familyId }).select("_id").session(session).lean();
  if (!kid) return false;

  // 1. Gifts not yet locked: release (escrow back to available, stock back to the store).
  const open = await WishListItem.find({ kidId, status: trusted({ $in: ["active", "fully_funded"] }) })
    .select("kidId familyId itemId status fundedCentipoints inventoryReserved seasonYear")
    .session(session)
    .lean<ReleasableGift[]>();
  for (const w of open) await releaseGiftInSession(w, session, now);

  // 2. Locked or later: the store is involved (and owed) → keep the row, Spirit of Santa keeps the gift.
  await WishListItem.updateMany(
    { kidId, status: trusted({ $in: ["locked", "shipped", "delivered"] }), familyDeletedAt: null },
    { $set: { familyDeletedAt: now } },
    { session },
  );
  // Finished history (incl. the rows just released): nothing a store or the ledger needs.
  await WishListItem.deleteMany({ kidId, status: trusted({ $in: ["removed", "unfunded"] }) }, { session });

  // 3. All of the child's Christmas Magic goes to Spirit of Santa (one ledger row; unique key = never twice).
  const bal = await Kid.findOne({ _id: kidId }).select("availableCentipoints escrowedCentipoints").session(session).lean();
  const magic = (bal?.availableCentipoints ?? 0) + (bal?.escrowedCentipoints ?? 0);
  if (magic > 0) {
    await Transaction.create(
      [{ kidId, familyId, seasonYear: getSeasonYear(now), type: "forfeit", amountCentipoints: magic, idempotencyKey: `erase:${kidId}` }],
      { session },
    );
  }

  // 4. The child's own records.
  await Deed.deleteMany({ kidId }, { session });
  await KidVote.deleteMany({ kidId }, { session });
  await Kid.deleteOne({ _id: kidId, familyId }, { session });
  await AuditLog.create([{ actorUserId, action: "kid.delete", targetType: "kid", targetId: kidId, details: { forfeitedCentipoints: magic, giftsReleased: open.length } }], { session });
  return true;
}

/** Parent deletes ONE child (PIN-gated by the caller). Replaces the old deleteKid (which lost store payouts). */
export async function eraseKid(parent: Parent, rawKidId: string, now = new Date()): Promise<EraseKidResult> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return { ok: false, error: "notFound" };
  await connectDb();
  if (!(await Kid.exists({ _id: kidId, familyId: fid }))) return { ok: false, error: "notFound" };
  await closeKidPayLater(kidId);
  await ensureLock(deedLock(kidId));
  const done = await withTransaction((session) => eraseKidInSession(kidId, fid, parent.id, session, now));
  return done ? { ok: true } : { ok: false, error: "notFound" };
}

export type EraseFamilyResult = { ok: true } | { ok: false; error: "notFound" };

/**
 * Delete the WHOLE family account (the caller has checked: PIN unlocked, password re-entered, confirm word).
 * Child by child (each its own transaction, retry-safe), then the family + parent account in one last
 * transaction. If anything fails half-way the parent can simply try again: finished children are gone, the
 * rest continue. Afterwards the parent is emailed a confirmation (a failed email never undoes or fails it).
 */
export async function eraseFamily(parent: Parent, now = new Date()): Promise<EraseFamilyResult> {
  const fid = await ownFamilyId(parent);
  if (!fid) return { ok: false, error: "notFound" };
  await connectDb();
  const user = await User.findOne({ _id: parent.id, familyId: fid }).select("email locale").lean();
  if (!user) return { ok: false, error: "notFound" };

  const kids = await Kid.find({ familyId: fid }).select("_id").lean();
  for (const k of kids) {
    const kidId = String(k._id);
    await closeKidPayLater(kidId);
    await ensureLock(deedLock(kidId));
    await withTransaction((session) => eraseKidInSession(kidId, fid, parent.id, session, now));
  }

  await withTransaction(async (session) => {
    // A child added in the meantime (another device)? Refuse to orphan it: the parent retries.
    if (await Kid.exists({ familyId: fid }).session(session)) throw new Error("family still has children");
    await Family.deleteOne({ _id: fid, ownerUserId: parent.id }, { session });
    await ActionToken.deleteMany({ email: user.email }, { session });
    await User.deleteOne({ _id: parent.id }, { session });
    await AuditLog.create([{ actorUserId: parent.id, action: "family.delete", targetType: "family", targetId: fid, details: { children: kids.length } }], { session });
  });
  await sendEmail({ to: user.email, locale: user.locale ?? "en", template: "accountDeleted", values: { link: `${familyAppOrigin()}/` } }).catch((e: unknown) =>
    console.error("[families] account-deleted email failed:", e instanceof Error ? e.message : "unknown"),
  );
  return { ok: true };
}

export type ErasePreview = { children: number; magicCentipoints: number; giftsKept: number };

/** What deleting the family would do, shown BEFORE the parent confirms (read-only). */
export async function erasePreview(parent: Parent): Promise<ErasePreview | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  await connectDb();
  const [kids, giftsKept] = await Promise.all([
    Kid.find({ familyId: fid }).select("availableCentipoints escrowedCentipoints").lean(),
    WishListItem.countDocuments({ familyId: fid, status: trusted({ $in: ["locked", "shipped"] }) }),
  ]);
  const magicCentipoints = kids.reduce((sum, k) => sum + (k.availableCentipoints ?? 0) + (k.escrowedCentipoints ?? 0), 0);
  return { children: kids.length, magicCentipoints, giftsKept };
}
