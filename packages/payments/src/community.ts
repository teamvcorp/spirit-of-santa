/**
 * Community / corporate donations (/donate), Phase 5 slice 2. SERVER-ONLY.
 * User decisions 2026-11-06 (CODEMAP "Phase 5"):
 *  - A gift goes to "all kids" or to kids in ONE US ZIP. It POOLS (Payment purpose "donation",
 *    fulfilment "held", zip on the Payment) and is split ONCE at the season freeze (Dec 1) in
 *    EQUAL shares among registered kids, after the admin-set platform fee (slice 2b).
 *  - So gifts are accepted only while the season is OPEN (before the freeze), and a checkout
 *    must finish by then (expires_at = min(freeze, 23.5 h)).
 *  - Tax receipt for every gift (receipts.ts), from what the donor types in Stripe Checkout.
 *  - The browser only sends a choice + zip; the amount is checked here (presets / $5–$50,000)
 *    and again by the webhook.
 */
import "server-only";
import { connectDb, Payment } from "@repo/db";
import { parseDollarsToCents } from "@repo/lib/format";
import { DONATION_PRESETS_CENTS, MAX_CHECKOUT_MS, MAX_DONATION_CENTS, MIN_CHECKOUT_MS, MIN_DONATION_CENTS } from "@repo/lib/limits";
import { getSeasonYear, startOfDayInZone } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";
import { NOT_OFFERED_PAYMENT_METHODS } from "./checkout.ts";
import { getStripe } from "./client.ts";
import { buildPaymentMetadata } from "./metadata.ts";
import { checkoutReturnStatus } from "./return-status.ts";

/** Amount from the form: a preset ("2500") or "other" + dollars ("150.00"), within bounds. */
export function donationAmountCents(choice: string, otherDollars: string): number | null {
  if (choice === "other") {
    const c = parseDollarsToCents(otherDollars.trim());
    return c != null && c >= MIN_DONATION_CENTS && c <= MAX_DONATION_CENTS ? c : null;
  }
  const preset = Number(choice);
  return (DONATION_PRESETS_CENTS as readonly number[]).includes(preset) ? preset : null;
}

/** Gifts are taken while the season is OPEN; pools are split at the freeze (Central-Time midnight). */
export async function donationWindow(): Promise<{ open: boolean; freezeAt: Date }> {
  const s = await getSeasonState();
  return { open: s.phase === "open", freezeAt: startOfDayInZone(s.dates.freeze) };
}

export type CommunityStart = { ok: true; clientSecret: string; amountCents: number } | { ok: false; error: "amount" | "zip" | "closed" | "stripe" };

export async function startCommunityDonation(
  input: { zip: string | null; amountCents: number | null; locale: "en" | "es" },
  origin: string,
  localePath: (p: string) => string,
): Promise<CommunityStart> {
  const { amountCents, zip } = input;
  if (amountCents == null || !Number.isSafeInteger(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) return { ok: false, error: "amount" };
  if (zip !== null && !/^\d{5}$/.test(zip)) return { ok: false, error: "zip" };
  const win = await donationWindow();
  const endsAt = Math.min(win.freezeAt.getTime(), Date.now() + MAX_CHECKOUT_MS);
  if (!win.open || endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "closed" };

  const metadata = buildPaymentMetadata({ sos_purpose: "donation", ...(zip ? { sos_zip: zip } : {}), sos_locale: input.locale });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      submit_type: "donate",
      excluded_payment_method_types: [...NOT_OFFERED_PAYMENT_METHODS], // owner: no crypto (2026-11-08)
      expires_at: Math.floor(endsAt / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: zip ? `Gift for Spirit of Santa kids in ${zip}` : "Gift for all Spirit of Santa kids" } },
        },
      ],
      // Metadata on BOTH the session and the PaymentIntent (the webhook reads the PaymentIntent;
      // receipts read the session's locale).
      metadata,
      payment_intent_data: { metadata },
      return_url: new URL(localePath("/donate/thanks"), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    return session.client_secret ? { ok: true, clientSecret: session.client_secret, amountCents } : { ok: false, error: "stripe" };
  } catch (err) {
    console.error("[community] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "stripe" };
  }
}

/** After paying: "received" (in the pool) / "processing" / "review" / "open" / null. */
export async function communityDonationStatus(sessionId: string): Promise<"received" | "processing" | "review" | "open" | null> {
  const r = await checkoutReturnStatus(sessionId, (md) => md.sos_purpose === "donation");
  if (!r) return null;
  if (r.state !== "done") return r.state;
  // held (in the pool), credited (shared) or retained (season over): all received.
  return r.fulfilment === "held" || r.fulfilment === "credited" || r.fulfilment === "retained" ? "received" : "review";
}

/** This season's total given so far (all pools together; no per-zip numbers: small zips could identify kids). */
export async function seasonDonationTotal(now = new Date()): Promise<{ cents: number; gifts: number }> {
  await connectDb();
  const [row] = await Payment.aggregate<{ cents: number; gifts: number }>([
    { $match: { purpose: "donation", status: "succeeded", seasonYear: getSeasonYear(now) } },
    { $group: { _id: null, cents: { $sum: "$amountCents" }, gifts: { $sum: 1 } } },
  ]);
  return { cents: row?.cents ?? 0, gifts: row?.gifts ?? 0 };
}
