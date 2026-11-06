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
 *  - Stripe only sees "Spirit O Santa bonus magic": no child's name leaves our system.
 *  - 10 checkout starts per 15 min per parent (no flood of Stripe sessions).
 */
import "server-only";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { Kid, Payment, User } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MAX_CHECKOUT_MS, MIN_CHECKOUT_MS } from "@repo/lib/limits";
import { startOfDayInZone } from "@repo/lib/season";
import { buildPaymentMetadata, fulfilPaidPaymentIntent, getStripe } from "@repo/payments/checkout";
import { getSeasonState } from "@repo/stores/season";
import { ownFamilyId, type Parent } from "./kids.ts";

/** Bonus payments are possible right now (season open or frozen), and until when. */
export async function bonusWindow(): Promise<{ open: boolean; closeAt: Date }> {
  const season = await getSeasonState();
  return { open: season.phase === "open" || season.phase === "frozen", closeAt: startOfDayInZone(season.dates.close) };
}

export type BonusStart =
  | { ok: true; clientSecret: string; amountCents: number }
  | { ok: false; error: "notFound" | "amount" | "seasonClosed" | "rateLimited" | "stripe" };

/**
 * Start a bonus for one of the parent's registered kids. `amountCents` = null when the amount
 * wasn't valid. `origin` = this app's public URL; `localePath` adds the language prefix.
 */
export async function startBonus(parent: Parent, rawKidId: string, amountCents: number | null, origin: string, localePath: (p: string) => string): Promise<BonusStart> {
  if (amountCents == null) return { ok: false, error: "amount" };
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return { ok: false, error: "notFound" };
  const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null, "registration.status": "registered" }).select("_id").lean();
  if (!kid) return { ok: false, error: "notFound" };
  const win = await bonusWindow();
  const endsAt = Math.min(win.closeAt.getTime(), Date.now() + MAX_CHECKOUT_MS);
  if (!win.open || endsAt - Date.now() < MIN_CHECKOUT_MS) return { ok: false, error: "seasonClosed" };
  if (!(await hitRateLimit(`bonus-start:${parent.id}`, 10, 900))) return { ok: false, error: "rateLimited" };

  const user = await User.findById(parent.id).select("email").lean();
  const metadata = buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: kidId, sos_family_id: fid });
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      expires_at: Math.floor(endsAt / 1000),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Spirit O Santa bonus magic" } } }],
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
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (s.metadata?.sos_purpose !== "bonus" || s.metadata?.sos_family_id !== fid) return null;
    if (s.status === "open") return "open";
    if (s.status !== "complete") return null;
    const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
    // Paid? Record it now (same idempotent handler as the webhook; see @repo/payments fulfil.ts).
    if (piId && s.payment_status === "paid") await fulfilPaidPaymentIntent(piId).catch((e: unknown) => console.error("[return] fulfil failed:", e instanceof Error ? e.name : "unknown"));
    const pay = piId ? await Payment.findOne({ stripePaymentIntentId: piId, familyId: fid }).select("fulfilment").lean() : null;
    if (!pay) return "processing";
    return pay.fulfilment === "credited" ? "credited" : "review";
  } catch {
    return null;
  }
}
