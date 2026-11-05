/**
 * Stripe webhook entry point. The family app's route (app/api/webhooks/stripe/route.ts)
 * just calls handleStripeWebhook(request).
 *
 * Order of checks, and why:
 *  1. Body size cap: refuse huge bodies before reading them (cheap DoS guard).
 *  2. Signature: HMAC of the RAW body with our whsec_ secret, plus a 5-minute timestamp
 *     window (replay guard). Must be the exact bytes Stripe sent, so we read
 *     request.text() and never JSON.parse first. Anyone can POST to this URL; only Stripe
 *     can sign. Fails → 400, nothing else happens.
 *  3. Mode: test events never touch a live database and vice versa (expectedLivemode).
 *  4. Duplicates: StripeEvent log by event.id (Stripe retries and may double-deliver).
 *  5. Handler (handlers.ts) does the actual work in a DB transaction.
 *
 * Responses: 400 bad/unsigned request · 413 too big · 200 handled, ignored or duplicate ·
 * 500 temporary failure (DB down, Stripe API error) so Stripe RETRIES (up to 3 days in
 * live mode). Bodies are minimal and never echo error details.
 */
import "server-only";
import Stripe from "stripe";
import { connectDb, StripeEvent } from "@repo/db";
import { expectedLivemode } from "./client.ts";
import {
  onChargeRefunded,
  onCheckoutSessionPaid,
  onDispute,
  onPaymentIntentNotPaid,
  onPaymentIntentSucceeded,
  type Outcome,
} from "./handlers.ts";

/** Stripe events are a few KB; 1 MiB is generous and bounds memory per request. */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Verify the signature and parse the event. Throws Stripe's SignatureVerificationError. */
export function verifyStripeEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
  // Static Stripe.webhooks: verifying needs only the whsec_ secret, not an API key.
  // Default tolerance = 300 s (never pass 0: in stripe@23, 0 DISABLES the age check).
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/** Route an already-verified event to its handler. Exported for tests. */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return onPaymentIntentSucceeded(event.data.object);
    case "payment_intent.payment_failed":
      return onPaymentIntentNotPaid(event.data.object, "failed");
    case "payment_intent.canceled":
      return onPaymentIntentNotPaid(event.data.object, "canceled");
    case "charge.refunded":
      return onChargeRefunded(event.data.object);
    case "charge.dispute.created":
    case "charge.dispute.closed":
      return onDispute(event.data.object);
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onCheckoutSessionPaid(event.data.object);
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      // Nothing to undo: no points were credited, and pay-later links expire on OUR
      // 7-day clock (Phase 5 cron), not when one checkout attempt lapses.
      return { status: "ignored", note: "no_action_needed" };
    default:
      // Only subscribe to the 10 events in docs/CODEMAP.md; anything else is a config slip.
      return { status: "ignored", note: "unsubscribed_event_type" };
  }
}

/** Duplicate check → handler → log outcome. Throws on temporary failures (→ 500, retry). */
export async function processStripeEvent(event: Stripe.Event): Promise<Outcome> {
  await connectDb();
  const objectId = (event.data.object as { id?: string }).id?.slice(0, 100);
  const log = (status: "processed" | "ignored" | "failed", note: string) =>
    StripeEvent.updateOne(
      { eventId: event.id },
      {
        $set: { type: event.type, livemode: event.livemode, objectId, status, note: note.slice(0, 300) },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    );

  if (event.livemode !== expectedLivemode()) {
    await log("ignored", "livemode_mismatch");
    return { status: "ignored", note: "livemode_mismatch" };
  }

  const seen = await StripeEvent.findOne({ eventId: event.id }).select({ status: 1 }).lean();
  if (seen && seen.status !== "failed") return { status: seen.status, note: "duplicate" };

  try {
    const outcome = await dispatchStripeEvent(event);
    await log(outcome.status, outcome.note);
    return outcome;
  } catch (err) {
    // Any failure (incl. RetryLaterError and an unexpected duplicate-key error) → log
    // "failed" and return 500 so Stripe redelivers. Handlers are idempotent, so a retry is
    // always safe. (We used to treat every 11000 as "already done"; review 2026-11-05
    // showed that could swallow a credit, so handlers now deal with their own 11000s.)
    await log("failed", (err as Error).message?.slice(0, 120) || (err as Error).name || "error").catch(() => {});
    throw err;
  }
}

/** The whole request → response flow, used by the route handler. */
export async function handleStripeWebhook(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return json(500, { error: "not_configured" }); // Stripe retries once it's fixed
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BODY_BYTES) return json(413, { error: "too_large" });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) return json(413, { error: "too_large" });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json(400, { error: "missing_signature" });

  let event: Stripe.Event;
  try {
    event = verifyStripeEvent(rawBody, signature, secret);
  } catch {
    // Don't log the body or header: just that it happened (watch for bursts = probing).
    console.warn("[stripe-webhook] signature verification failed");
    return json(400, { error: "invalid_signature" });
  }

  try {
    const outcome = await processStripeEvent(event);
    return json(200, { received: true, status: outcome.status });
  } catch (err) {
    // ids + type only; never the payload (it can contain names/emails of payers).
    console.error("[stripe-webhook] processing failed", event.id, event.type, (err as Error).name);
    return json(500, { error: "processing_failed" });
  }
}
