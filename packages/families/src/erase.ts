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
 *    it). One child deleted: still delivered to the family. Whole family deleted: familyDeletedAt on all of the
 *    family's rows; the admin queue then says "keep for Spirit of Santa" instead of shipping.
 *  - Finished history rows (removed / unfunded): deleted.
 *  - Deeds (may hold free text), votes, the child: deleted. Live "pay later" text links for the deeds are
 *    switched off at Stripe first (the visitor's own consent record stays: it's theirs, 13-month rule).
 *  - Ledger (append-only) and Payment rows: kept; their kidId/familyId now point at nothing (anonymised).
 *  - Family (name, alias, address, PIN, consent record) and the parent's User + their email tokens: deleted.
 *  - AuditLog: kept (ids only, never names); one "kid.delete" / "family.delete" row records the deletion.
 * Tips arriving later for a deleted child are never credited: the webhook flags them for admin review.
 */
import "server-only";
import { ActionToken, AuditLog, connectDb, Deed, ensureLock, Family, Item, Kid, KidVote, PayLaterRequest, takeLock, Transaction, trusted, User, WishListItem, withTransaction, type DbSession } from "@repo/db";
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

/**
 * Switch off this child's live "pay later" text links at Stripe (a network call: can't be in the transaction).
 * Found through the visitor requests themselves (PayLaterRequest.kidId). Run BEFORE and AFTER the child's
 * transaction: pay-later creation doesn't take the deed lock, so a link made in between is caught afterwards.
 */
async function closeKidPayLater(kidId: string): Promise<void> {
  const deedIds = await PayLaterRequest.distinct("deedId", { kidId, active: true });
  for (const d of deedIds) await closePayLaterForDeed(String(d));
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
  // Escrow out of sync (the case that parks a gift at lock): the release's guard would throw on every retry and
  // block a COPPA deletion. Then drop the gift WITHOUT the impossible escrow move and log the shortfall instead.
  let shortfallCentipoints = 0;
  for (const w of open) {
    const k = await Kid.findOne({ _id: kidId }).select("escrowedCentipoints").session(session).lean();
    if ((k?.escrowedCentipoints ?? 0) >= w.fundedCentipoints) {
      await releaseGiftInSession(w, session, now);
    } else {
      shortfallCentipoints += w.fundedCentipoints;
      const r = await WishListItem.updateOne(
        { _id: String(w._id), status: w.status, fundedCentipoints: w.fundedCentipoints },
        { $set: { status: "removed", removedAt: now } },
        { session },
      );
      if (r.modifiedCount !== 1) throw new Error("wish list item changed during removal"); // the transaction retries
      // The store's set-aside unit still goes back (same as releaseGiftInSession), even though the escrow can't move.
      if (w.inventoryReserved) await Item.updateOne({ _id: String(w.itemId) }, { $inc: { inventory: 1 } }, { session });
    }
  }

  // 2. Locked or later: the store is involved (and owed) → the row always STAYS. Deleting ONE child of a family
  // that still exists: the gift still goes to the family's address (the "on its way" email is skipped: no child
  // name left to put in it). Whole family deleted: eraseFamily marks ALL its rows (also earlier-deleted children's).
  // Finished history (incl. the rows just released): nothing a store or the ledger needs.
  await WishListItem.deleteMany({ kidId, status: trusted({ $in: ["removed", "unfunded"] }) }, { session });

  // 3. The child's UNSPENT Christmas Magic goes to Spirit of Santa (one ledger row; unique key = never twice)
  // = available AFTER the releases above (they moved open gifts' points into available). Locked gifts' magic was
  // already SPENT at lock (Phase 8). Escrow still left now means the records disagree (old data before the
  // spend backfill, or a parked gift): never forfeited (it could count spent money twice), never blocking the
  // deletion (COPPA): logged for a human.
  const bal = await Kid.findOne({ _id: kidId }).select("availableCentipoints escrowedCentipoints").session(session).lean();
  const magic = bal?.availableCentipoints ?? 0;
  const escrowLeftCentipoints = bal?.escrowedCentipoints ?? 0;
  if (escrowLeftCentipoints > 0 || shortfallCentipoints > 0) {
    console.error("[families] deletion: escrow out of sync for a child (logged in the audit row)");
  }
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
  await AuditLog.create([{ actorUserId, action: "kid.delete", targetType: "kid", targetId: kidId, details: { forfeitedCentipoints: magic, giftsReleased: open.length, ...(escrowLeftCentipoints > 0 ? { escrowLeftCentipoints } : {}), ...(shortfallCentipoints > 0 ? { shortfallCentipoints } : {}) } }], { session });
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
  await closeKidPayLater(kidId);
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
    await closeKidPayLater(kidId);
  }

  await withTransaction(async (session) => {
    // A child added in the meantime (another device)? Refuse to orphan it: the parent retries.
    if (await Kid.exists({ familyId: fid }).session(session)) throw new Error("family still has children");
    // Nobody left to send gifts to: every gift a store still holds or sent us for this family (incl. children
    // deleted earlier one by one) is kept by Spirit of Santa; the store is still paid (rows stay).
    await WishListItem.updateMany(
      { familyId: fid, status: trusted({ $in: ["locked", "shipped", "delivered"] }), familyDeletedAt: null },
      { $set: { familyDeletedAt: now } },
      { session },
    );
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
  // Same rule as the deletion: available + what open (not yet locked) gifts hold. Never the escrow of gifts
  // already locked with a store (that magic was spent).
  const [kids, open, giftsKept] = await Promise.all([
    Kid.find({ familyId: fid }).select("availableCentipoints").lean(),
    WishListItem.find({ familyId: fid, status: trusted({ $in: ["active", "fully_funded"] }) }).select("fundedCentipoints").lean(),
    WishListItem.countDocuments({ familyId: fid, status: trusted({ $in: ["locked", "shipped"] }) }),
  ]);
  const magicCentipoints =
    kids.reduce((sum, k) => sum + (k.availableCentipoints ?? 0), 0) + open.reduce((sum, w) => sum + (w.fundedCentipoints ?? 0), 0);
  return { children: kids.length, magicCentipoints, giftsKept };
}
