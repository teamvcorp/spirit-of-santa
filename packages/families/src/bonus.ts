/**
 * Parent "bonus magic" (Phase 5 slice 1): a parent pays by card and the points go to ONE of their
 * own REGISTERED children. SERVER-ONLY. Callers: signed-in parent with the PIN unlocked.
 *
 *  - The browser only says which kid + which amount choice; the amount is re-checked here
 *    (caller uses tipAmountCents: presets / $1–$1,000) and AGAIN by the webhook (MIN/MAX_TIP_CENTS).
 *  - Points are computed by the webhook from the money actually received ($1.50 = 1 point,
 *    server constant), never from anything the browser sent.
 *  - Only while the season is open or frozen: a bonus paid after Dec 25 would be wiped a few days
 *    later by the Jan 1 reset. Checkout expires at min(season close, 23.5 h).
 *  - Stripe only sees "Spirit of Santa bonus magic": no child's name leaves our system.
 *  - 10 checkout starts per 15 min per parent, counted BEFORE any lookup (no flood, no probing).
 *  - Tips, donation links and bonuses deliberately share ONE set of amount limits (TIP_PRESETS_CENTS,
 *    MIN/MAX_TIP_CENTS): they are all "small gifts to a kid"; the webhook re-checks the same bounds.
 */
import "server-only";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { Kid, User } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MAX_CHECKOUT_MS, MAX_TIP_CENTS, MIN_CHECKOUT_MS, MIN_TIP_CENTS } from "@repo/lib/limits";
import { buildPaymentMetadata, checkoutReturnStatus, creditReturnState, CHECKOUT_EXCLUDED_METHODS, getStripe, paymentMethodConfig } from "@repo/payments/checkout";
import { giftWindow } from "@repo/stores/season";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";


export type BonusStart =
  | { ok: true; clientSecret: string; amountCents: number }
  | { ok: false; error: "notFound" | "amount" | "seasonClosed" | "rateLimited" | "stripe" };

/**
 * Start a bonus for one of the parent's registered kids. `amountCents` = null when the amount
 * wasn't valid; it is ALSO bounds-checked here (never trust the caller). `origin` = this app's
 * public URL; `localePath` adds the language prefix.
 */
export async function startBonus(parent: Parent, rawKidId: string, amountCents: number | null, origin: string, localePath: (p: string) => string): Promise<BonusStart> {
  // Same bounds the webhook enforces: refusing here avoids charging money that would only be flagged.
  if (amountCents == null || !Number.isSafeInteger(amountCents) || amountCents < MIN_TIP_CENTS || amountCents > MAX_TIP_CENTS) return { ok: false, error: "amount" };
  const kidId = normalizeObjectId(rawKidId);
  if (!kidId) return { ok: false, error: "notFound" };
  // Rate limit FIRST: probing attempts (other families' ids, closed season) count too.
  if (!(await hitRateLimit(`bonus-start:${parent.id}`, 10, 900))) return { ok: false, error: "rateLimited" };
  const [fid, win, user] = await Promise.all([ownFamilyId(parent), giftWindow(), User.findById(parent.id).select("email").lean()]);
  if (!fid) return { ok: false, error: "notFound" };
  const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null, "registration.status": "registered" }).select("_id").lean();
  if (!kid) return { ok: false, error: "notFound" };
  const endsAt = Math.min(win.closeAt.getTime(), Date.now() + MAX_CHECKOUT_MS);
  if (!win.open || endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "seasonClosed" };

  const metadata = buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: fid });
  try {
    const session = await getStripe().checkout.sessions.create({
      ...paymentMethodConfig(), // Spirit of Santa's own payment-method group (Link off)
      ui_mode: "embedded_page",
      mode: "payment",
      excluded_payment_method_types: [...CHECKOUT_EXCLUDED_METHODS], // money must arrive while the magic is spendable
      expires_at: Math.floor(endsAt / 1000),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Spirit of Santa bonus magic" } } }],
      // Metadata on BOTH the session and the PaymentIntent (the webhook reads the PaymentIntent).
      metadata,
      payment_intent_data: { metadata },
      customer_email: user?.email,
      return_url: new URL(localePath("/parent/bonus/return"), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    return session.client_secret ? { ok: true, clientSecret: session.client_secret, amountCents } : { ok: false, error: "stripe" };
  } catch (err) {
    console.error("[bonus] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "stripe" };
  }
}

/** After paying: "credited" / "processing" / "review" / "open" / null (only this family's bonus sessions). */
export async function bonusStatus(parent: Parent, sessionId: string): Promise<"credited" | "processing" | "review" | "open" | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  return creditReturnState(await checkoutReturnStatus(sessionId, (md) => md.sos_purpose === "bonus" && md.sos_family_id === fid));
}
