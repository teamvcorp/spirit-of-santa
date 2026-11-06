/**
 * Switching off pay-later text links (Phase 5 slice 4b). SERVER-ONLY. Single source used by:
 *  - the webhook, when a deed is paid another way (pay now) → its texted link must not take a
 *    second payment (review 2026-11-06);
 *  - "say thank you" (@repo/deeds/public thankDeed) → same;
 *  - the daily expiry job (@repo/deeds/pay-later expirePayLaterLinks).
 * Idempotent; a link Stripe no longer knows (resource_missing) counts as switched off.
 */
import "server-only";
import { connectDb, PayLaterRequest, trusted } from "@repo/db";
import { getStripe } from "./client.ts";

/** Statuses whose link may still be payable. */
export const LIVE_PAY_LATER = ["creating", "sending", "sent"] as const;

/** Switch off one Stripe Payment Link. true = off (or already gone); false = Stripe failed (retry later). */
export async function deactivateLink(linkId: string): Promise<boolean> {
  try {
    await getStripe().paymentLinks.update(linkId, { active: false });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return true;
    console.error("[pay-later] link switch-off failed:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

/**
 * The deed was thanked or paid another way: close any live pay-later request for it (link off,
 * request no longer "active", so it stops blocking/showing). Best-effort per link.
 */
export async function closePayLaterForDeed(deedId: string): Promise<number> {
  await connectDb();
  const live = await PayLaterRequest.find({ deedId, active: true, status: trusted({ $in: [...LIVE_PAY_LATER] }) }).select("paymentLinkId").lean();
  let closed = 0;
  for (const r of live) {
    if (r.paymentLinkId && !(await deactivateLink(r.paymentLinkId))) continue; // retried by the daily job
    const res = await PayLaterRequest.updateOne({ _id: r._id, status: trusted({ $in: [...LIVE_PAY_LATER] }) }, { $set: { status: "closed" }, $unset: { active: 1 } });
    closed += res.modifiedCount;
  }
  return closed;
}
