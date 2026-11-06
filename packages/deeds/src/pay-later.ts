/**
 * "Pay later by text" (Phase 5 slice 4b). SERVER-ONLY. REGISTERED with the carriers
 * (Toll-Free Verification, docs/vendor/twilio.md): a web form on the deed page, an unticked consent
 * box, EXACTLY ONE text per request with a payment link that expires (≤ 7 days), no marketing,
 * STOP/HELP. Don't change the flow or the wording without updating the registration.
 *
 * startPayLater: consent + amount + US number + the deed can take money (tipTarget, the same rule
 * as paying now) → under a per-number LOCK: max 3 texts per number per 24 h (failed attempts don't
 * count) + the consent record (PayLaterRequest; one ACTIVE request per deed) → single-use Stripe
 * Payment Link → status "sending" → the one text → "sent". If the text fails the link is switched
 * off and the request freed (failed, inactive).
 *
 * Expiry: a link expires at least a day BEFORE the deed/season deadline, so the once-a-day cron
 * (expirePayLaterLinks, which runs before the season end) switches it off in time. The text says
 * "expires in N days" rounded DOWN (never promises more), and a link needs ≥ 1 full day.
 * A deed thanked or paid another way closes its link (@repo/payments/pay-later-links).
 */
import "server-only";
import { connectDb, ensureLock, PayLaterRequest, takeLock, trusted, withTransaction } from "@repo/db";
import { SMS_CONSENT_VERSION } from "@repo/lib/family";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, PAY_LATER_LINK_DAYS } from "@repo/lib/limits";
import { maskPhone, toUsE164 } from "@repo/lib/phone";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { deactivateLink, LIVE_PAY_LATER } from "@repo/payments/pay-later-links";
import { sendSms, SmsError, smsFailureFor } from "@repo/sms";
import { tipTarget } from "./public.ts";
import { phoneKey } from "./qr.ts";

import { DAY_MS } from "@repo/lib/time";
/** Texts per phone number per 24 h (abuse limit: nobody can flood a number through many QR codes). */
const PHONE_DAILY_LIMIT = 3;

/**
 * The ONE text we send (registered wording, docs/vendor/twilio.md). English for everyone: that is
 * the registered sample; a Spanish version must be registered before it is used.
 */
export function payLaterText(url: string, days: number): string {
  return `Spirit O Santa: here is your link to pay the tip for the good deed you received. It expires in ${days} ${days === 1 ? "day" : "days"}: ${url} Msg & data rates may apply. Reply STOP to opt out, HELP for help`;
}

/**
 * When a new link must expire: 7 days, but at least one day before the deed/season deadline (the
 * daily cron then switches it off before the deadline). null = less than a full day left. Pure.
 */
export function payLaterExpiry(now: number, payableUntil: number): Date | null {
  const at = Math.min(now + PAY_LATER_LINK_DAYS * DAY_MS, payableUntil - DAY_MS);
  return at - now >= DAY_MS ? new Date(at) : null;
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
  const expiresAt = payLaterExpiry(now, target.payableUntil);
  if (!expiresAt) return { ok: false, error: "expired" };

  await connectDb();
  const key = phoneKey(phone);
  const lockName = `paylater-phone:${key}`;
  await ensureLock(lockName); // outside the transaction (see lock.ts)
  // Per-number limit + the consent record, atomically per number (parallel requests can't overshoot).
  type Created = { id: unknown } | { error: "phoneLimit" | "alreadySent" };
  const created = await withTransaction(async (session): Promise<Created> => {
    await takeLock(lockName, session);
    const recent = await PayLaterRequest.countDocuments({ phoneKey: key, createdAt: trusted({ $gte: new Date(now - DAY_MS) }), status: trusted({ $ne: "failed" }) }).session(session);
    if (recent >= PHONE_DAILY_LIMIT) return { error: "phoneLimit" };
    try {
      const [req] = await PayLaterRequest.create(
        [
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
            active: true, // one ACTIVE request per deed (partial unique index)
          },
        ],
        { session },
      );
      return { id: req!._id };
    } catch (err) {
      if (isDuplicateKey(err)) return { error: "alreadySent" };
      throw err;
    }
  });
  if ("error" in created) return { ok: false, error: created.error };
  const requestId = created.id;
  const free = (error: string) => PayLaterRequest.updateOne({ _id: requestId }, { $set: { status: "failed", error }, $unset: { active: 1 } });

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
    await free("stripe");
    return { ok: false, error: "stripe" };
  }
  // "sending" BEFORE the text: from here on we treat the link as possibly delivered.
  await PayLaterRequest.updateOne({ _id: requestId }, { $set: { status: "sending", paymentLinkId: link.id, paymentLinkUrl: link.url } });

  const days = Math.floor((expiresAt.getTime() - now) / DAY_MS); // rounded DOWN, ≥ 1
  let sid: string;
  try {
    sid = (await sendSms({ to: phone, body: payLaterText(link.url, days) })).sid;
  } catch (err) {
    // Not delivered: switch the link off, free the deed for another try.
    await deactivateLink(link.id);
    const code = err instanceof SmsError ? err.code : 0;
    console.error("[pay-later] text failed:", code || (err instanceof Error ? err.name : "unknown"));
    await free(String(code || "sms"));
    const reason = smsFailureFor(code);
    return { ok: false, error: reason === "optedOut" ? "optedOut" : reason === "badNumber" ? "phone" : "sms" };
  }
  // The text went out. If recording that fails, it stays "sending", which every reader treats as sent.
  await PayLaterRequest.updateOne({ _id: requestId }, { $set: { status: "sent", smsSid: sid } }).catch((e: unknown) =>
    console.error("[pay-later] could not record 'sent':", e instanceof Error ? e.name : "unknown"),
  );
  return { ok: true, masked: maskPhone(phone), expiresAt };
}

/** A live pay-later text for this deed (shown instead of the form). Expired ones don't count. */
export async function payLaterForDeed(deedId: string): Promise<{ masked: string; expiresAt: Date } | null> {
  await connectDb();
  const r = await PayLaterRequest.findOne({ deedId, active: true, status: trusted({ $in: ["sending", "sent"] }), expiresAt: trusted({ $gt: new Date() }) })
    .select("phoneE164 expiresAt")
    .lean();
  return r ? { masked: maskPhone(r.phoneE164), expiresAt: r.expiresAt } : null;
}

/**
 * Daily (money cron, BEFORE the season end): switch off links past their expiry; clean up requests
 * stuck in "creating" (server stopped mid-request: no text was sent). Each link on its own: one
 * Stripe error doesn't stop the rest (it's retried next run).
 */
export async function expirePayLaterLinks(now = new Date()): Promise<{ expired: number; cleaned: number; failed: number }> {
  await connectDb();
  let expired = 0;
  let cleaned = 0;
  let failed = 0;
  const due = await PayLaterRequest.find({ status: trusted({ $in: [...LIVE_PAY_LATER] }), expiresAt: trusted({ $lte: now }) })
    .select("paymentLinkId")
    .sort({ expiresAt: 1 })
    .limit(500)
    .lean();
  for (const r of due) {
    if (r.paymentLinkId && !(await deactivateLink(r.paymentLinkId))) {
      failed++;
      continue;
    }
    const res = await PayLaterRequest.updateOne({ _id: r._id, status: trusted({ $in: [...LIVE_PAY_LATER] }) }, { $set: { status: "expired" }, $unset: { active: 1 } });
    expired += res.modifiedCount;
  }
  const stuck = await PayLaterRequest.find({ status: "creating", createdAt: trusted({ $lte: new Date(now.getTime() - 15 * 60_000) }) }).select("paymentLinkId").limit(500).lean();
  for (const r of stuck) {
    if (r.paymentLinkId && !(await deactivateLink(r.paymentLinkId))) {
      failed++;
      continue;
    }
    const res = await PayLaterRequest.updateOne({ _id: r._id, status: "creating" }, { $set: { status: "failed", error: "stuck" }, $unset: { active: 1 } });
    cleaned += res.modifiedCount;
  }
  return { expired, cleaned, failed };
}
