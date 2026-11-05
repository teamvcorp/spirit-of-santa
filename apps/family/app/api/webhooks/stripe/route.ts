/**
 * POST /api/webhooks/stripe: Stripe → us. Register this exact URL in the Stripe Dashboard
 * (https://spiritofsanta.com/api/webhooks/stripe, snapshot payload, API version
 * 2026-09-30.endive; the 10 events are listed in docs/CODEMAP.md).
 *
 * All logic lives in @repo/payments/webhook (signature check, duplicate guard, handlers).
 * Not behind the locale proxy (matcher skips /api) and has no session/CSRF check: Stripe's
 * signature IS the authentication. Only POST is exported, so other methods get 405.
 */
import { handleStripeWebhook } from "@repo/payments/webhook";

export async function POST(request: Request): Promise<Response> {
  return handleStripeWebhook(request);
}
