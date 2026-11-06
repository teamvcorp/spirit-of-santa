/**
 * Tax receipts for community donations (/donate), Phase 5 slice 2. SERVER-ONLY.
 *
 * Flow: the donation payment is recorded (webhook or return page) → ensureDonationReceipt creates
 * ONE receipt row (unique per PaymentIntent) → sendPendingReceipts emails it, but only once an
 * admin has switched receipts on AND filled in the charity's legal name + EIN (a receipt is only
 * valid if the 501(c)(3) really receives the gift; see settings.ts). Until then rows stay
 * "pending" and go out when receipts are switched on (admin save) or on the daily cron.
 *
 * No double emails: each send first CLAIMS the row (compare-and-set on `attempts`), and Resend's
 * idempotency key (`receipt/<receiptNo>`, 24 h) stops a duplicate request.
 */
import "server-only";
import { connectDb, DonationReceipt, Payment, trusted } from "@repo/db";
import { sendEmail } from "@repo/email";
import { formatCents } from "@repo/lib/format";
import { getStripe } from "./client.ts";
import { getPlatformSettings } from "./settings.ts";

const MAX_ATTEMPTS = 5;
const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

/**
 * Create (once) the receipt for a RECORDED community donation. Safe to call repeatedly.
 * `link` = the family app's /donate page (put in the email).
 */
export async function ensureDonationReceipt(piId: string, link: string): Promise<void> {
  await connectDb();
  if (await DonationReceipt.exists({ stripePaymentIntentId: piId })) return;
  const pay = await Payment.findOne({ stripePaymentIntentId: piId, purpose: "donation", status: "succeeded" })
    .select("amountCents seasonYear createdAt")
    .lean();
  if (!pay) return;

  // Donor email + name = what they typed in Stripe Checkout (we never ask for it ourselves).
  let email: string | undefined;
  let donorName: string | undefined;
  let locale: "en" | "es" = "en";
  try {
    const cs = (await getStripe().checkout.sessions.list({ payment_intent: piId, limit: 1 })).data[0];
    email = cs?.customer_details?.email ?? undefined;
    donorName = cs?.customer_details?.name?.slice(0, 120) ?? undefined;
    if (cs?.metadata?.sos_locale === "es") locale = "es";
  } catch {
    // e.g. a test event with a made-up id: the row is still created (an admin can see it).
  }
  const receiptNo = `SOS-${pay.seasonYear}-${piId.replace(/^pi_/, "").slice(-16).toUpperCase()}`;
  try {
    await DonationReceipt.create({
      stripePaymentIntentId: piId,
      receiptNo,
      seasonYear: pay.seasonYear,
      amountCents: pay.amountCents,
      donatedAt: pay.createdAt ?? new Date(),
      email,
      donorName,
      locale,
      link,
      ...(email ? {} : { status: "failed", lastError: "no donor email from Stripe" }),
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // another caller created it first: fine
  }
}

export type SendSummary = { sent: number; failed: number; waiting: number };

/**
 * Email pending receipts (oldest first), if receipts are switched on and the charity details are
 * filled in. `onlyPiId` limits it to one donation (right after it was recorded).
 */
export async function sendPendingReceipts(opts: { onlyPiId?: string; limit?: number } = {}): Promise<SendSummary> {
  await connectDb();
  const settings = await getPlatformSettings();
  const filter: { status: "pending"; stripePaymentIntentId?: string } = { status: "pending", ...(opts.onlyPiId ? { stripePaymentIntentId: opts.onlyPiId } : {}) };
  if (!settings.receiptsReady) return { sent: 0, failed: 0, waiting: await DonationReceipt.countDocuments(filter) };

  const rows = await DonationReceipt.find(filter).sort({ createdAt: 1 }).limit(opts.limit ?? 25).lean();
  const summary: SendSummary = { sent: 0, failed: 0, waiting: 0 };
  for (const r of rows) {
    // Claim it: only one sender wins this attempt.
    const claim = await DonationReceipt.updateOne({ _id: r._id, status: "pending", attempts: r.attempts }, { $inc: { attempts: 1 } });
    if (claim.modifiedCount === 0) continue;
    if (!r.email) {
      await DonationReceipt.updateOne({ _id: r._id }, { $set: { status: "failed", lastError: "no donor email" } });
      summary.failed++;
      continue;
    }
    try {
      const date = new Intl.DateTimeFormat(r.locale === "es" ? "es-US" : "en-US", { dateStyle: "long", timeZone: "America/Chicago" }).format(r.donatedAt);
      await sendEmail({
        to: r.email,
        locale: r.locale,
        template: "donationReceipt",
        values: {
          link: r.link ?? "https://spiritofsanta.com/donate",
          receiptNo: r.receiptNo,
          amount: formatCents(r.amountCents),
          date,
          donorName: r.donorName || "-",
          orgName: settings.charity.legalName,
          ein: settings.charity.ein,
          orgAddress: settings.charity.address || "-",
        },
        idempotencyKey: `receipt/${r.receiptNo}`,
      });
      await DonationReceipt.updateOne({ _id: r._id }, { $set: { status: "sent", sentAt: new Date() }, $unset: { lastError: 1 } });
      summary.sent++;
    } catch (err) {
      const giveUp = r.attempts + 1 >= MAX_ATTEMPTS;
      await DonationReceipt.updateOne(
        { _id: r._id },
        { $set: { lastError: (err instanceof Error ? err.name : "send failed").slice(0, 200), ...(giveUp ? { status: "failed" } : {}) } },
      );
      summary.failed++;
    }
  }
  return summary;
}

/** Counts for the admin page. */
export async function receiptCounts(): Promise<Record<"pending" | "sent" | "failed", number>> {
  await connectDb();
  const rows = await DonationReceipt.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return { pending: by.pending ?? 0, sent: by.sent ?? 0, failed: by.failed ?? 0 };
}

/** Re-queue failed receipts (e.g. after fixing settings); those without an email stay failed. */
export async function retryFailedReceipts(): Promise<number> {
  await connectDb();
  const r = await DonationReceipt.updateMany({ status: "failed", email: trusted({ $exists: true, $ne: "" }) }, { $set: { status: "pending", attempts: 0 } });
  return r.modifiedCount;
}
