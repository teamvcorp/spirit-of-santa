/**
 * GET /api/cron/donations: daily community-donation job (Phase 5 slice 2b).
 *  1. Split every held donation pool (only once the season is frozen/closed and the fee is set;
 *     before that it does nothing). Daily runs share late gifts too.
 *  2. Email tax receipts still waiting (receipts switched on, gift on/after the start day).
 * Called by Vercel Cron (apps/store/vercel.json) with `Authorization: Bearer <CRON_SECRET>`
 * (same secret as purge-signups); anyone else gets 401. Lives in the store app so ONE project
 * holds the cron secret (all apps share the database).
 */
import { timingSafeEqual } from "node:crypto";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { runDonationSplit } from "@repo/payments/split";

/**
 * Up to 5 minutes (Vercel Fluid compute; check the project's plan limit). The split credits kids in
 * resumable batches, so even a timeout only delays the rest to the next run or an admin "Split now".
 */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  // Constant-time compare; refuse entirely if no secret is configured.
  if (!secret || secret.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Independent jobs: one failing must not skip the other.
  const [split, receipts] = await Promise.allSettled([runDonationSplit({ trigger: "cron" }), sendPendingReceipts({ limit: 50 })]);
  const result = {
    split: split.status === "fulfilled" ? split.value : "failed",
    receipts: receipts.status === "fulfilled" ? receipts.value : "failed",
  };
  if (split.status === "rejected" || receipts.status === "rejected") {
    console.error("[cron] donations partly failed", split.status === "rejected" ? "split" : "", receipts.status === "rejected" ? "receipts" : "");
    return Response.json(result, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[cron] donations", JSON.stringify(result)); // totals/counts only, no personal data
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
