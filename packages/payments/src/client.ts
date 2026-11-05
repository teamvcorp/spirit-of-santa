/**
 * Server-side Stripe client. SERVER-ONLY: the secret key must never reach a browser
 * (CLAUDE.md). `import "server-only"` turns an accidental client import into a build error.
 *
 * - One lazily created client per server instance (creating one is cheap, but reusing it
 *   keeps connection pooling and telemetry sane).
 * - API version: pinned by the SDK (stripe@23.0.1 → "2026-09-30.endive"). We don't
 *   override it, so TypeScript types always match the responses. Set the webhook
 *   endpoint's API version in the Stripe Dashboard to the SAME value (snapshot payloads
 *   are rendered in the endpoint's version).
 */
import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set"); // never log the key itself
  client = new Stripe(key, {
    maxNetworkRetries: 2, // retries are safe: the SDK sends idempotency keys on POSTs
    timeout: 10_000, // fail fast inside a webhook rather than hang until Vercel kills it
    appInfo: { name: "SpiritOfSanta" },
  });
  return client;
}

/**
 * Which Stripe mode our key belongs to: true = live, false = test/sandbox.
 * Events whose `livemode` differs are ignored, so test events can never move real points
 * (e.g. if a test endpoint is ever pointed at production by mistake).
 */
export function expectedLivemode(key = process.env.STRIPE_SECRET_KEY): boolean {
  if (key && /^(sk|rk)_live_/.test(key)) return true;
  if (key && /^(sk|rk)_test_/.test(key)) return false;
  throw new Error("STRIPE_SECRET_KEY is missing or not a recognised Stripe secret/restricted key");
}
