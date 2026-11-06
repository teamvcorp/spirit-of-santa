/**
 * Admin review of "Other" deed text (admin app /moderation). SERVER-ONLY; callers check the admin
 * role. Admins see ONLY the text and dates (never the child's name): enough to decide whether
 * it's fine to show publicly. Approve = shown on the QR page; hide = never shown ("a good deed").
 */
import "server-only";
import { AuditLog, connectDb, Deed, withTransaction } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";

export type PendingText = { id: string; text: string; createdAt: Date };

export async function listPendingTexts(limit = 100): Promise<PendingText[]> {
  await connectDb();
  const rows = await Deed.find({ customReview: "pending" }).sort({ createdAt: 1 }).limit(limit).select("customDescription createdAt").lean();
  return rows.map((r) => ({ id: String(r._id), text: r.customDescription ?? "", createdAt: r.createdAt }));
}

export async function countPendingTexts(): Promise<number> {
  await connectDb();
  return Deed.countDocuments({ customReview: "pending" });
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
