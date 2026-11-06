/**
 * Fulfil a paid Checkout from the RETURN page as well as from the webhook. SERVER-ONLY.
 *
 * Why (Stripe's recommended pattern, docs/vendor/stripe.md): the webhook can be late, retried, or
 * (in local dev without the Stripe CLI) never arrive. So when a parent/donor comes back from
 * Stripe, the status page asks Stripe directly and, if the money really arrived, runs the SAME
 * handler the webhook uses.
 *
 * Safety:
 *  - Acts only on what Stripe's API says, fetched server-side with our secret key; nothing from
 *    the browser is trusted (the session id only says WHICH session to ask about, and callers
 *    already checked it belongs to this family/deed/kid).
 *  - Idempotent: onPaymentIntentSucceeded is keyed on the unique PaymentIntent id, so whichever of
 *    webhook / return page runs first does the work and the other changes nothing.
 *  - Same mode by construction: a PaymentIntent retrieved with our key is in our (test/live) mode.
 */
import "server-only";
import { connectDb, Payment } from "@repo/db";
import { getStripe } from "./client.ts";
import { onPaymentIntentSucceeded } from "./handlers.ts";

export async function fulfilPaidPaymentIntent(piId: string): Promise<void> {
  if (!/^pi_[A-Za-z0-9_]{10,200}$/.test(piId)) return;
  await connectDb();
  // Already recorded by the webhook (or an earlier visit): skip the Stripe call.
  if (await Payment.exists({ stripePaymentIntentId: piId, status: "succeeded" })) return;
  const pi = await getStripe().paymentIntents.retrieve(piId);
  if (pi.status !== "succeeded") return;
  await onPaymentIntentSucceeded(pi);
}
