/**
 * Parent "pay-up" checkout (Phase 6 slice 4): pay the MISSING amount of one unfinished gift during
 * the pay-up window (payUpWindow: PAY_UP_DAYS after the Dec 1 share-out landed). SERVER-ONLY. Callers: signed-in parent
 * with the PIN unlocked. Built like bonus.ts (same Stripe embedded checkout + return-page check).
 *
 *  - The browser only names the gift; the AMOUNT is computed here from the database (missing
 *    points × $1.50, rounded up, ≥ Stripe's $0.50 minimum), never sent by the browser.
 *  - The webhook re-checks the gift belongs to that kid + family, credits "earn_payup" and fills
 *    THAT gift first. If tips finished it meanwhile, the money still becomes the kid's points.
 *  - Checkout expires at min(window close, 23.5 h). Stripe only sees "Spirit of Santa gift
 *    pay-up": no child's or item's name leaves our system.
 *  - NO DELAYED PAYMENT METHODS (bank debits, vouchers, customer balance): they settle days later,
 *    possibly after the close when the gift has already dropped off (review 2026-11-06). Stripe SDK
 *    v23 has no payment_method_types on Checkout, so we EXCLUDE them (docs/vendor/stripe.md). A late
 *    payment is still credited and flagged for an admin by the webhook (second safety net).
 *  - 20 checkout starts per 15 min per parent. The (global) window is checked BEFORE the counter,
 *    so clicking around outside the window never locks a parent out; lookups come after it.
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { Kid, User, WishListItem } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MAX_CHECKOUT_MS, MIN_CHECKOUT_MS } from "@repo/lib/limits";
import { buildPaymentMetadata, checkoutReturnStatus, creditReturnState, DELAYED_PAYMENT_METHODS, getStripe } from "@repo/payments/checkout";
import { payUpCents, payUpWindow } from "@repo/wishlists/payup";

export type PayUpStart =
  | { ok: true; clientSecret: string; amountCents: number }
  | { ok: false; error: "notFound" | "windowClosed" | "notNeeded" | "rateLimited" | "stripe" };

export async function startPayUp(parent: Parent, rawWishId: string, origin: string, localePath: (p: string) => string): Promise<PayUpStart> {
  const wishId = normalizeObjectId(rawWishId);
  if (!wishId) return { ok: false, error: "notFound" };
  const win = await payUpWindow();
  if (!win.open) return { ok: false, error: "windowClosed" };
  if (!(await hitRateLimit(`payup-start:${parent.id}`, 20, 900))) return { ok: false, error: "rateLimited" };
  const [fid, user] = await Promise.all([ownFamilyId(parent), User.findById(parent.id).select("email").lean()]);
  if (!fid) return { ok: false, error: "notFound" };
  const w = await WishListItem.findOne({ _id: wishId, familyId: fid })
    .select("kidId status seasonYear costCentipoints fundedCentipoints")
    .lean<{ kidId: unknown; status: string; seasonYear: number; costCentipoints: number; fundedCentipoints: number }>();
  if (!w) return { ok: false, error: "notFound" };
  const kid = await Kid.findOne({ _id: String(w.kidId), familyId: fid, archivedAt: null, "registration.status": "registered" }).select("_id").lean();
  if (!kid) return { ok: false, error: "notFound" };
  const endsAt = Math.min(win.closesAt.getTime(), Date.now() + MAX_CHECKOUT_MS);
  if (w.seasonYear !== win.seasonYear || endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "windowClosed" };
  if (w.status !== "active" || w.fundedCentipoints >= w.costCentipoints) return { ok: false, error: "notNeeded" };
  const amountCents = payUpCents(w.costCentipoints - w.fundedCentipoints);

  const metadata = buildPaymentMetadata({ sos_purpose: "payup", sos_kid_id: String(w.kidId), sos_family_id: fid, sos_wish_list_item_id: wishId });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      excluded_payment_method_types: [...DELAYED_PAYMENT_METHODS],
      expires_at: Math.floor(endsAt / 1000),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Spirit of Santa gift pay-up" } } }],
      // Metadata on BOTH the session and the PaymentIntent (the webhook reads the PaymentIntent).
      metadata,
      payment_intent_data: { metadata },
      customer_email: user?.email,
      return_url: new URL(localePath("/parent/payup/return"), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    return session.client_secret ? { ok: true, clientSecret: session.client_secret, amountCents } : { ok: false, error: "stripe" };
  } catch (err) {
    console.error("[payup] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "stripe" };
  }
}

/** After paying: "credited" / "processing" / "review" / "open" / null (only this family's pay-up sessions). */
export async function payUpStatus(parent: Parent, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  return creditReturnState(await checkoutReturnStatus(sessionId, (md) => md.sos_purpose === "payup" && md.sos_family_id === fid));
}
