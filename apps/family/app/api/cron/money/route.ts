/**
 * GET /api/cron/money: the DAILY MONEY JOB (Phase 5). Lives in the FAMILY app because that app
 * already holds every payment secret (Stripe, Twilio, email) and the Stripe webhook; the store app
 * keeps only its sign-up cleanup cron (moved 2026-11-06: the store has no Stripe key, and copying
 * money secrets into more projects widens the blast radius).
 * Each part checks the season itself and does nothing when it isn't its time, IN ORDER:
 *  1. Split held donation pools (only while frozen, fee set). Daily runs share late gifts too.
 *  2. Season end (only in the off-season, once per ended season): unshared donation money
 *     retained, every kid's points reset to 0 with a ledger row.
 *  3. Switch off expired pay-later text links (Phase 5 slice 4b).
 *  4. Email tax receipts still waiting (receipts switched on, gift on/after the start day).
 * Called by Vercel Cron (apps/family/vercel.json) with `Authorization: Bearer <CRON_SECRET>`;
 * anyone else gets 401. (Vercel Hobby allows 2 cron jobs: this + the store's purge-signups.)
 */
import { timingSafeEqual } from "node:crypto";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { expirePayLaterLinks } from "@repo/deeds/pay-later";
import { runSeasonReset } from "@repo/payments/season-end";
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
  // IN ORDER (review 2026-11-06): the split first, because it also finishes any interrupted run;
  // only then the season end (which refuses while a split is still crediting kids). One failing
  // must not skip the others.
  const settle = async <T>(job: () => Promise<T>): Promise<PromiseSettledResult<T>> => {
    try {
      return { status: "fulfilled", value: await job() };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  };
  const split = await settle(() => runDonationSplit({ trigger: "cron" }));
  const seasonEnd = await settle(() => runSeasonReset());
  const payLater = await settle(() => expirePayLaterLinks());
  const receipts = await settle(() => sendPendingReceipts({ limit: 50 }));
  const result = {
    split: split.status === "fulfilled" ? split.value : "failed",
    seasonEnd: seasonEnd.status === "fulfilled" ? seasonEnd.value : "failed",
    payLater: payLater.status === "fulfilled" ? payLater.value : "failed",
    receipts: receipts.status === "fulfilled" ? receipts.value : "failed",
  };
  const failed = [split, seasonEnd, payLater, receipts].some((r) => r.status === "rejected");
  if (failed) {
    console.error("[cron] money job partly failed", JSON.stringify({ split: split.status, seasonEnd: seasonEnd.status, payLater: payLater.status, receipts: receipts.status }));
    return Response.json(result, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[cron] donations", JSON.stringify(result)); // totals/counts only, no personal data
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
