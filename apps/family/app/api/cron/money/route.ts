/**
 * GET /api/cron/money: the DAILY MONEY JOB (Phase 5). Lives in the FAMILY app because that app
 * already holds every payment secret (Stripe, Twilio, email) and the Stripe webhook; the store app
 * keeps only its sign-up cleanup cron (moved 2026-11-06: the store has no Stripe key, and copying
 * money secrets into more projects widens the blast radius).
 * Each part checks the season itself and does nothing when it isn't its time, IN ORDER:
 *  1. Split held donation pools (only while frozen, fee set). Daily runs share late gifts too.
 *  2. Switch off expired pay-later text links (Phase 5 slice 4b), BEFORE the season end.
 *     Then wish lists (Phase 6): lock items (30 days funded, or all at the freeze); sweep unallocated
 *     points; Dec 25 close (unfinished gifts drop off, points → Spirit O Santa); then email each store its new gifts to set aside / ready to ship (needs STORE_APP_URL);
 *     then retry failed "gift on its way" parent emails (needs FAMILY_APP_URL).
 *  3. Season end (only in the off-season, once per ended season): unshared donation money
 *     retained, every kid's points reset to 0 with a ledger row.
 *  4. Email tax receipts still waiting (receipts switched on, gift on/after the start day).
 * Called by Vercel Cron (apps/family/vercel.json) with `Authorization: Bearer <CRON_SECRET>`;
 * anyone else gets 401. (Vercel Hobby allows 2 cron jobs: this + the store's purge-signups.)
 */
import { timingSafeEqual } from "node:crypto";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { expirePayLaterLinks } from "@repo/deeds/pay-later";
import { runSeasonReset } from "@repo/payments/season-end";
import { runDonationSplit } from "@repo/payments/split";
import { lockFundedItems, sweepAllocations } from "@repo/wishlists/engine";
import { closeUnfunded } from "@repo/wishlists/payup";
import { purgeUnneededAddresses, sendFamilyNotices, sendStoreDigests } from "@repo/wishlists/fulfilment";

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
  // Expired pay-later links off BEFORE the season end, so none is payable after points reset.
  const payLater = await settle(() => expirePayLaterLinks());
  // Wish lists (Phase 6): fully funded 30+ days → locked; then a safety sweep of unallocated points.
  // Then the Dec 25 close: unfinished gifts drop off, their points go to Spirit O Santa (BEFORE the Jan 1 reset).
  const wishLists = await settle(async () => ({ locked: await lockFundedItems(), sweep: await sweepAllocations(), closed: await closeUnfunded() }));
  // After locking, so gifts locked today are in today's "ready to ship" email.
  const storeOrders = await settle(() => sendStoreDigests());
  // "Your gift is on its way" emails that failed when the admin sent the gift (retry, 14 days).
  const familyNotices = await settle(() => sendFamilyNotices());
  // Delivery addresses are kept only while a gift is on its way (data minimisation).
  const addresses = await settle(() => purgeUnneededAddresses());
  const seasonEnd = await settle(() => runSeasonReset());
  const receipts = await settle(() => sendPendingReceipts({ limit: 50 }));
  const result = {
    split: split.status === "fulfilled" ? split.value : "failed",
    seasonEnd: seasonEnd.status === "fulfilled" ? seasonEnd.value : "failed",
    payLater: payLater.status === "fulfilled" ? payLater.value : "failed",
    wishLists: wishLists.status === "fulfilled" ? wishLists.value : "failed",
    storeOrders: storeOrders.status === "fulfilled" ? storeOrders.value : "failed",
    familyNotices: familyNotices.status === "fulfilled" ? familyNotices.value : "failed",
    addressesPurged: addresses.status === "fulfilled" ? addresses.value : "failed",
    receipts: receipts.status === "fulfilled" ? receipts.value : "failed",
  };
  // A digest that ran but couldn't email some stores also counts as failed (it never throws per store).
  const digestFailed = storeOrders.status === "fulfilled" && storeOrders.value.failed > 0;
  const noticesFailed = familyNotices.status === "fulfilled" && familyNotices.value.failed > 0;
  const closeFailed = wishLists.status === "fulfilled" && wishLists.value.closed.failed > 0;
  const failed = digestFailed || noticesFailed || closeFailed || [split, seasonEnd, payLater, wishLists, storeOrders, familyNotices, addresses, receipts].some((r) => r.status === "rejected");
  if (failed) {
    console.error("[cron] money job partly failed", JSON.stringify({ split: split.status, seasonEnd: seasonEnd.status, payLater: payLater.status, wishLists: wishLists.status, storeOrders: storeOrders.status, familyNotices: familyNotices.status, addresses: addresses.status, receipts: receipts.status, digestFailed, noticesFailed, closeFailed }));
    return Response.json(result, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[cron] donations", JSON.stringify(result)); // totals/counts only, no personal data
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
