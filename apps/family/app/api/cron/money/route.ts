/**
 * GET /api/cron/money: the DAILY MONEY JOB (Phase 5). Lives in the FAMILY app because that app
 * already holds every payment secret (Stripe, Twilio, email) and the Stripe webhook; the store app
 * keeps only its sign-up cleanup cron (moved 2026-11-06: the store has no Stripe key, and copying
 * money secrets into more projects widens the blast radius).
 * Each part checks the season itself and does nothing when it isn't its time, IN ORDER:
 *  1. Split held donation pools (only while frozen, fee set). Daily runs share late gifts too.
 *  2. Switch off expired pay-later text links (Phase 5 slice 4b), BEFORE the season end.
 *     Then wish lists (Phase 6): lock items (30 days funded, or all at the freeze) and SPEND their magic (ledger
 *     "spend", Phase 8); sweep unallocated
 *     points; Dec 25 close (unfinished gifts drop off, points → Spirit of Santa); then email each store its new gifts to set aside / ready to ship (needs STORE_APP_URL);
 *     then retry failed "gift on its way" parent emails (needs FAMILY_APP_URL); finish "deliver, then delete"
 *     account deletions whose gifts arrived (Phase 8); delete addresses no gift needs;
 *     Phase 7: each parent's daily summary (magic + deeds) and the season reminders (email only).
 *  3. Season end (Jan 1, while the new season waits in "resetting"; run EARLY, right after the split):
 *     unshared donation money retained, every kid's unspent points reset to 0 with a ledger row.
 *  4. Email tax receipts still waiting (receipts switched on, gift on/after the start day).
 * Called by Vercel Cron (apps/family/vercel.json) with `Authorization: Bearer <CRON_SECRET>`;
 * anyone else gets 401. (Vercel Hobby allows 2 cron jobs: this + the store's purge-signups.)
 */
import { timingSafeEqual } from "node:crypto";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { finalizeClosingFamilies } from "@repo/families/erase";
import { expirePayLaterLinks } from "@repo/deeds/pay-later";
import { runSeasonReset } from "@repo/payments/season-end";
import { runDonationSplit } from "@repo/payments/split";
import { lockFundedItems, sweepAllocations } from "@repo/wishlists/engine";
import { closeUnfunded } from "@repo/wishlists/payup";
import { sendFamilyDigests, sendSeasonReminders } from "@repo/families/digest";
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
      // Production: error TYPE only (messages can hold connection details). Development: the full
      // stack, so a failing job can actually be diagnosed.
      const dev = process.env.NODE_ENV !== "production";
      console.error("[cron] job failed:", reason instanceof Error ? (dev ? reason.stack : reason.name) : "unknown");
      return { status: "rejected", reason };
    }
  };
  const split = await settle(() => runDonationSplit({ trigger: "cron" }));
  // Expired pay-later links off BEFORE the season end, so none is payable after points reset.
  const payLater = await settle(() => expirePayLaterLinks());
  // Year-round calendar: on Jan 1 the whole family site waits in "resetting" until this finishes, so it runs
  // EARLY (right after the split it depends on). It only zeroes unspent (available) magic; the wish-list steps
  // below work on escrow, so the order is safe.
  const seasonEnd = await settle(() => runSeasonReset());
  // Wish lists (Phase 6): fully funded 30+ days → locked + magic spent (Phase 8); then a safety sweep of unallocated points.
  // Then the Dec 25 close: unfinished gifts drop off, their points go to Spirit of Santa (BEFORE the Jan 1 reset).
  const wishLists = await settle(async () => ({ locked: await lockFundedItems(), sweep: await sweepAllocations(), closed: await closeUnfunded() }));
  // After locking, so gifts locked today are in today's "ready to ship" email.
  const storeOrders = await settle(() => sendStoreDigests());
  // "Your gift is on its way" emails that failed when the admin sent the gift (retry, 14 days).
  const familyNotices = await settle(() => sendFamilyNotices());
  // "Deliver, then delete" (Phase 8): AFTER the delivery emails (they need the closing family's contact), delete
  // closing families whose gifts all arrived, or that reached their deadline.
  const closing = await settle(() => finalizeClosingFamilies());
  // Delivery addresses are kept only while a gift is on its way (data minimisation).
  const addresses = await settle(() => purgeUnneededAddresses());
  // Phase 7: parents' daily summary (magic + deeds thanked) and season reminders (email only).
  const digests = await settle(() => sendFamilyDigests());
  const reminders = await settle(() => sendSeasonReminders());
  const receipts = await settle(() => sendPendingReceipts({ limit: 50 }));
  const result = {
    split: split.status === "fulfilled" ? split.value : "failed",
    seasonEnd: seasonEnd.status === "fulfilled" ? seasonEnd.value : "failed",
    payLater: payLater.status === "fulfilled" ? payLater.value : "failed",
    wishLists: wishLists.status === "fulfilled" ? wishLists.value : "failed",
    storeOrders: storeOrders.status === "fulfilled" ? storeOrders.value : "failed",
    familyNotices: familyNotices.status === "fulfilled" ? familyNotices.value : "failed",
    closingFamilies: closing.status === "fulfilled" ? closing.value : "failed",
    addressesPurged: addresses.status === "fulfilled" ? addresses.value : "failed",
    digests: digests.status === "fulfilled" ? digests.value : "failed",
    reminders: reminders.status === "fulfilled" ? reminders.value : "failed",
    receipts: receipts.status === "fulfilled" ? receipts.value : "failed",
  };
  // A digest that ran but couldn't email some stores also counts as failed (it never throws per store).
  const digestFailed = storeOrders.status === "fulfilled" && storeOrders.value.failed > 0;
  const noticesFailed = familyNotices.status === "fulfilled" && familyNotices.value.failed > 0;
  const closeFailed = wishLists.status === "fulfilled" && wishLists.value.closed.failed > 0;
  const lockFailed = wishLists.status === "fulfilled" && wishLists.value.locked.failed > 0;
  const closingFailed = closing.status === "fulfilled" && closing.value.failed > 0;
  // The Jan 1 reset ran but didn't finish, or finished with kids flagged for an admin: the family site may be
  // waiting in "resetting". Loud every day until fixed (admin /season has "Run the season reset now").
  const resetStuck = seasonEnd.status === "fulfilled" && seasonEnd.value.ok && (!seasonEnd.value.done || seasonEnd.value.needsAttention > 0);
  // Gifts PARKED for a human (bad data at lock or at the Dec 25 close) keep failing the job EVERY day until fixed:
  // their magic is neither spent nor forfeited, so it must never sit there quietly past the season (Phase 8 review).
  const parked = wishLists.status === "fulfilled" && (wishLists.value.locked.needsAttention > 0 || wishLists.value.closed.needsAttention > 0);
  const parentEmailsFailed = (digests.status === "fulfilled" && digests.value.failed > 0) ||
    (reminders.status === "fulfilled" && [reminders.value.cutoff, reminders.value.payUp].some((r) => r !== "notTime" && r.failed > 0));
  const failed = digestFailed || noticesFailed || closeFailed || lockFailed || parked || closingFailed || resetStuck || parentEmailsFailed || [split, seasonEnd, payLater, wishLists, storeOrders, familyNotices, closing, addresses, digests, reminders, receipts].some((r) => r.status === "rejected");
  if (failed) {
    console.error("[cron] money job partly failed", JSON.stringify({ split: split.status, seasonEnd: seasonEnd.status, payLater: payLater.status, wishLists: wishLists.status, storeOrders: storeOrders.status, familyNotices: familyNotices.status, closing: closing.status, addresses: addresses.status, digests: digests.status, reminders: reminders.status, receipts: receipts.status, digestFailed, noticesFailed, closeFailed, lockFailed, parked, closingFailed, resetStuck, parentEmailsFailed }));
    return Response.json(result, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[cron] donations", JSON.stringify(result)); // totals/counts only, no personal data
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
