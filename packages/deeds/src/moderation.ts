/**
 * Admin review of "Other" deed text (admin app /moderation). SERVER-ONLY; callers check the admin
 * role. Admins see ONLY the text and dates (never the child's name): enough to decide whether
 * it's fine to show publicly. Approve = shown on the QR page; hide = never shown ("a good deed").
 */
import "server-only";
import { AuditLog, connectDb, Deed, Family, trusted, withTransaction } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";

export type PendingText = { id: string; text: string; createdAt: Date };

/**
 * Texts worth reviewing: still pending AND on a deed whose QR page can still show it (unused,
 * unexpired). Older ones can never appear publicly, so they don't clutter the queue.
 */
const reviewable = () => ({ customReview: "pending" as const, status: "pending" as const, qrUsedAt: null, expiresAt: trusted({ $gt: new Date() }) });

export async function listPendingTexts(limit = 100): Promise<PendingText[]> {
  await connectDb();
  const rows = await Deed.find(reviewable()).sort({ createdAt: 1 }).limit(limit).select("customDescription createdAt").lean();
  return rows.map((r) => ({ id: String(r._id), text: r.customDescription ?? "", createdAt: r.createdAt }));
}

export async function countPendingTexts(): Promise<number> {
  await connectDb();
  const [deeds, aliases] = await Promise.all([Deed.countDocuments(reviewable()), Family.countDocuments({ aliasReview: "pending", alias: trusted({ $exists: true }) })]);
  return deeds + aliases;
}

/** Family nicknames waiting for review (text + date only). */
export async function listPendingAliases(limit = 100): Promise<PendingText[]> {
  await connectDb();
  const rows = await Family.find({ aliasReview: "pending", alias: trusted({ $exists: true }) }).sort({ updatedAt: 1 }).limit(limit).select("alias updatedAt").lean();
  return rows.map((r) => ({ id: String(r._id), text: r.alias ?? "", createdAt: r.updatedAt }));
}

/** Approve or hide one family nickname (CAS on "pending" + audit). */
export async function reviewAlias(adminId: string, rawId: string, decision: "approved" | "rejected"): Promise<ReviewResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return { ok: false, error: "notFound" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await Family.updateOne({ _id: id, aliasReview: "pending" }, { $set: { aliasReview: decision } }, { session });
    if (res.modifiedCount !== 1) return { ok: false, error: "notFound" } as const;
    await AuditLog.create([{ actorUserId: adminId, action: "family.alias_review", targetType: "family", targetId: id, details: { decision } }], { session });
    return { ok: true } as const;
  });
}

export type ReviewResult = { ok: true } | { ok: false; error: "notFound" };

/** Approve or hide one text. Compare-and-set on "pending" + audit in one transaction. */
export async function reviewDeedText(adminId: string, rawId: string, decision: "approved" | "rejected"): Promise<ReviewResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return { ok: false, error: "notFound" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await Deed.updateOne({ _id: id, customReview: "pending" }, { $set: { customReview: decision } }, { session });
    if (res.modifiedCount !== 1) return { ok: false, error: "notFound" } as const;
    await AuditLog.create([{ actorUserId: adminId, action: "deed.text_review", targetType: "deed", targetId: id, details: { decision } }], { session });
    return { ok: true } as const;
  });
}
