/**
 * "Pay later by text" (Phase 5 slice 4b). SERVER-ONLY. REGISTERED with the carriers
 * (Toll-Free Verification, docs/vendor/twilio.md): a web form on the deed page, an unticked consent
 * box, EXACTLY ONE text per request with a payment link that expires (≤ 7 days), no marketing,
 * STOP/HELP. Don't change the flow or the wording without updating the registration.
 *
 * Steps (startPayLater): consent + amount + US number + the deed can take money (tipTarget, the
 * same rule as paying now) → limits (one request per deed, 3 per number per day) → consent record
 * (PayLaterRequest) → single-use Stripe Payment Link (metadata = a normal deed tip, so the existing
 * webhook credits it and confirms the deed) → the text. If the text fails, the link is switched
 * off at once. Expired links are switched off by the daily money cron (expirePayLaterLinks).
 */
import "server-only";
import { connectDb, Deed, PayLaterRequest, trusted } from "@repo/db";
import { SMS_CONSENT_VERSION } from "@repo/lib/family";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, PAY_LATER_LINK_DAYS } from "@repo/lib/limits";
import { maskPhone, toUsE164 } from "@repo/lib/phone";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { sendSms, SmsError, smsFailureFor } from "@repo/sms";
import { tipTarget } from "./public.ts";
import { hashDeedToken, isDeedToken, phoneKey } from "./qr.ts";

const DAY_MS = 86_400_000;
/** Less than this left before the deed/season closes: don't text a link that dies right away. */
const MIN_LINK_MS = 2 * 3_600_000;
/** Texts per phone number per 24 h (abuse limit: nobody can flood a number through many QR codes). */
const PHONE_DAILY_LIMIT = 3;

/**
 * The ONE text we send (registered wording, docs/vendor/twilio.md). English for everyone: that is
 * the registered sample; a Spanish version must be registered before it is used.
 */
export function payLaterText(url: string, days: number): string {
  return `Spirit O Santa: here is your link to pay the tip for the good deed you received. It expires in ${days} ${days === 1 ? "day" : "days"}: ${url} Msg & data rates may apply. Reply STOP to opt out, HELP for help`;
}

export type PayLaterError =
  | "invalid" | "used" | "expired" | "seasonClosed"
  | "consent" | "amount" | "phone"
  | "alreadySent" | "phoneLimit"
  | "optedOut" | "stripe" | "sms";
export type PayLaterResult = { ok: true; masked: string; expiresAt: Date } | { ok: false; error: PayLaterError };

const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

export async function startPayLater(
  token: unknown,
  input: { phone: string; consent: boolean; amountCents: number | null; locale: "en" | "es" },
): Promise<PayLaterResult> {
  // Consent is an ACTIVE choice (the form's box is never pre-ticked); re-checked here.
  if (!input.consent) return { ok: false, error: "consent" };
  const { amountCents } = input;
  if (amountCents == null || !Number.isSafeInteger(amountCents) || amountCents < MIN_TIP_CENTS || amountCents > MAX_TIP_CENTS) return { ok: false, error: "amount" };
  const phone = toUsE164(input.phone);
  if (!phone) return { ok: false, error: "phone" };
  const target = await tipTarget(token);
  if (!target.ok) return target;
  const now = Date.now();
  const expiresAt = new Date(Math.min(now + PAY_LATER_LINK_DAYS * DAY_MS, target.payableUntil));
  if (expiresAt.getTime() - now < MIN_LINK_MS) return { ok: false, error: "expired" };

  await connectDb();
  const key = phoneKey(phone);
  if ((await PayLaterRequest.countDocuments({ phoneKey: key, createdAt: trusted({ $gte: new Date(now - DAY_MS) }) })) >= PHONE_DAILY_LIMIT) {
    return { ok: false, error: "phoneLimit" };
  }
  // The consent record first (unique per deed: a second request for this deed fails here).
  let requestId: unknown;
  try {
    const [req] = await PayLaterRequest.create([
      {
        deedId: target.deedId,
        kidId: target.kidId,
        familyId: target.familyId,
        phoneE164: phone,
        phoneKey: key,
        consentAt: new Date(now),
        consentVersion: SMS_CONSENT_VERSION,
        consentLocale: input.locale,
        amountCents,
        expiresAt,
      },
    ]);
    requestId = req!._id;
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, error: "alreadySent" };
    throw err;
  }
  const fail = (error: string) => PayLaterRequest.updateOne({ _id: requestId }, { $set: { status: "failed", error } });

  // Single-use Stripe Payment Link: a normal deed tip (the webhook credits it + confirms the deed).
  const metadata = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: target.kidId, sos_family_id: target.familyId, sos_deed_id: target.deedId });
  let link: { id: string; url: string };
  try {
    link = await getStripe().paymentLinks.create({
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Tip for a good deed (Spirit O Santa)" } } }],
      // No submit_type "donate": that serves the link from donate.stripe.com, but the text sample
      // REGISTERED with the carriers shows buy.stripe.com (docs/vendor/twilio.md). Keep them matching.
      metadata, // copied to the Checkout Session (onCheckoutSessionPaid switches the link off once paid)
      payment_intent_data: { metadata }, // on the PaymentIntent (the webhook credits points from it)
      restrictions: { completed_sessions: { limit: 1 } }, // can be paid once
      inactive_message: "This payment link has expired or was already used. Thank you!",
      after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message: "Thank you! Your tip is on its way to the child's Christmas wish list." } },
    });
  } catch (err) {
    console.error("[pay-later] payment link failed:", err instanceof Error ? err.name : "unknown");
    await fail("stripe");
    return { ok: false, error: "stripe" };
  }
  await PayLaterRequest.updateOne({ _id: requestId }, { $set: { paymentLinkId: link.id, paymentLinkUrl: link.url } });

  // The one text. Days shown = what is actually left (may be < 7 near the deed/season end).
  const days = Math.max(1, Math.floor((expiresAt.getTime() - now) / DAY_MS));
  try {
    const { sid } = await sendSms({ to: phone, body: payLaterText(link.url, days) });
    await PayLaterRequest.updateOne({ _id: requestId }, { $set: { status: "sent", smsSid: sid } });
  } catch (err) {
    // Never leave a live link nobody received: switch it off, record why.
    await getStripe().paymentLinks.update(link.id, { active: false }).catch(() => undefined);
    const code = err instanceof SmsError ? err.code : 0;
    console.error("[pay-later] text failed:", code || (err instanceof Error ? err.name : "unknown"));
    await fail(String(code || "sms"));
    const reason = smsFailureFor(code);
    return { ok: false, error: reason === "optedOut" ? "optedOut" : reason === "badNumber" ? "phone" : "sms" };
  }
  return { ok: true, masked: maskPhone(phone), expiresAt };
}

/** Was a pay-later text already sent for this deed? (The deed page shows that instead of the form.) */
export async function payLaterForDeed(token: unknown): Promise<{ masked: string; expiresAt: Date; status: string } | null> {
  if (!isDeedToken(token)) return null;
  await connectDb();
  const deed = await Deed.findOne({ qrTokenHash: hashDeedToken(token) }).select("_id").lean();
  if (!deed) return null;
  const r = await PayLaterRequest.findOne({ deedId: deed._id, status: trusted({ $in: ["sent", "paid"] }) }).select("phoneE164 expiresAt status").lean();
  return r ? { masked: maskPhone(r.phoneE164), expiresAt: r.expiresAt, status: r.status } : null;
}

/**
 * Daily (money cron): switch off links past their expiry; clean up requests stuck in "creating"
 * (e.g. the server stopped mid-request). Returns how many links were switched off.
 */
export async function expirePayLaterLinks(now = new Date()): Promise<{ expired: number; cleaned: number }> {
  await connectDb();
  let expired = 0;
  let cleaned = 0;
  const due = await PayLaterRequest.find({ status: "sent", expiresAt: trusted({ $lte: now }) }).select("paymentLinkId").limit(500).lean();
  for (const r of due) {
    if (r.paymentLinkId) await getStripe().paymentLinks.update(r.paymentLinkId, { active: false });
    const res = await PayLaterRequest.updateOne({ _id: r._id, status: "sent" }, { $set: { status: "expired" } });
    expired += res.modifiedCount;
  }
  const stuck = await PayLaterRequest.find({ status: "creating", createdAt: trusted({ $lte: new Date(now.getTime() - 15 * 60_000) }) }).select("paymentLinkId").limit(500).lean();
  for (const r of stuck) {
    if (r.paymentLinkId) await getStripe().paymentLinks.update(r.paymentLinkId, { active: false });
    const res = await PayLaterRequest.updateOne({ _id: r._id, status: "creating" }, { $set: { status: "failed", error: "stuck" } });
    cleaned += res.modifiedCount;
  }
  return { expired, cleaned };
}
