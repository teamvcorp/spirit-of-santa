/**
 * $5 child registration = the card payment that verifies parental consent (COPPA, user decisions
 * 2026-11-05). SERVER-ONLY. Callers: signed-in parent with the PIN unlocked.
 *
 *  - The SERVER decides the amount ($5 x kids); the browser only says which of its own awaiting
 *    kids to register. Metadata (set with our secret key, unforgeable by the payer) tells the
 *    webhook which kids; the webhook marks them registered (@repo/payments handlers.ts).
 *  - Promo code (FAMILY_PROMO_CODE env, blank = off): the family pays $5 once (first child) and
 *    the rest are free. If the family ALREADY paid a registration by card, further children are
 *    registered right away for free (the parent was already verified by that card payment).
 *  - Money is platform revenue: no points. No refunds (platform rule).
 */
import "server-only";
import { AuditLog, connectDb, Family, Kid, Payment, trusted, User, withTransaction } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MAX_KIDS_PER_FAMILY, REGISTRATION_FEE_CENTS } from "@repo/lib/limits";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import type { Parent } from "./kids.ts";

/** Case- and space-insensitive promo check. Blank/missing env = promo switched off. */
export function promoMatches(input: string | undefined | null): boolean {
  const code = (process.env.FAMILY_PROMO_CODE ?? "").trim().toLowerCase();
  return code.length > 0 && (input ?? "").trim().toLowerCase() === code;
}

async function ownFamily(parent: Parent) {
  const fid = normalizeObjectId(parent.familyId);
  if (!fid) return null;
  await connectDb();
  return Family.findOne({ _id: fid, ownerUserId: parent.id }).select("_id").lean();
}

/** The parent's kids that still need registering, limited to `wanted` (ids from the form). */
async function awaitingKids(familyId: string, wanted: string[]) {
  const ids = [...new Set(wanted.map(normalizeObjectId).filter((v): v is string => Boolean(v)))].slice(0, MAX_KIDS_PER_FAMILY);
  if (ids.length === 0) return [];
  return Kid.find({ _id: trusted({ $in: ids }), familyId, "registration.status": "awaiting" }).select("_id").sort({ createdAt: 1 }).lean<{ _id: unknown }[]>();
}

/** Has this family ever paid a registration by card? (Then the parent is already verified.) */
const familyHasPaid = (familyId: string) => Payment.exists({ familyId, purpose: "registration", status: "succeeded" });

export type StartResult =
  | { kind: "pay"; clientSecret: string; amountCents: number }
  | { kind: "free"; registered: number }
  | { kind: "error"; error: "notFound" | "noKids" | "badPromo" | "stripe" };

/**
 * Start registering the selected kids. Returns an Embedded Checkout client secret, or registers
 * them straight away (promo + family already verified). `origin` = this app's public URL.
 */
export async function startRegistration(parent: Parent, kidIds: string[], promo: string, origin: string, localePath: (p: string) => string): Promise<StartResult> {
  const fam = await ownFamily(parent);
  if (!fam) return { kind: "error", error: "notFound" };
  const fid = String(fam._id);
  const kids = await awaitingKids(fid, kidIds);
  if (kids.length === 0) return { kind: "error", error: "noKids" };
  const usePromo = promo.trim() !== "";
  if (usePromo && !promoMatches(promo)) return { kind: "error", error: "badPromo" };

  if (usePromo && (await familyHasPaid(fid))) {
    const registered = await withTransaction(async (session) => {
      const res = await Kid.updateMany(
        { _id: trusted({ $in: kids.map((k) => k._id) }), familyId: fam._id, "registration.status": "awaiting" },
        { $set: { "registration.status": "registered", "registration.registeredAt": new Date(), "registration.method": "promo" } },
        { session },
      );
      await AuditLog.create([{ actorUserId: parent.id, action: "kid.register_promo", targetType: "family", targetId: String(fam._id), details: { kids: res.modifiedCount } }], { session });
      return res.modifiedCount;
    });
    return { kind: "free", registered };
  }

  const ids = kids.map((k) => String(k._id));
  const quantity = usePromo ? 1 : ids.length;
  const metadata = buildPaymentMetadata({ sos_purpose: "registration", sos_family_id: String(fam._id), sos_kid_ids: ids.join(","), sos_promo: usePromo ? "1" : "0" });
  const user = await User.findById(parent.id).select("email").lean();
  try {
    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      line_items: [
        {
          quantity,
          price_data: { currency: "usd", unit_amount: REGISTRATION_FEE_CENTS, product_data: { name: "Spirit O Santa child registration" } },
        },
      ],
      // Metadata on BOTH the session and the PaymentIntent (the webhook reads the PaymentIntent).
      metadata,
      payment_intent_data: { metadata },
      customer_email: user?.email,
      return_url: new URL(localePath("/parent/register/return"), origin).toString() + "?session_id={CHECKOUT_SESSION_ID}",
    });
    if (!session.client_secret) return { kind: "error", error: "stripe" };
    return { kind: "pay", clientSecret: session.client_secret, amountCents: REGISTRATION_FEE_CENTS * quantity };
  } catch (err) {
    console.error("[registration] checkout session failed:", err instanceof Error ? err.name : "unknown");
    return { kind: "error", error: "stripe" };
  }
}

/**
 * For the return page: "complete" (paid; the webhook registers the kids, usually within
 * seconds), "open" (not paid: try again) or null (not this family's session / unknown).
 */
export async function registrationSessionStatus(parent: Parent, sessionId: string): Promise<"complete" | "open" | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  const fam = await ownFamily(parent);
  if (!fam) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (s.metadata?.sos_purpose !== "registration" || s.metadata?.sos_family_id !== String(fam._id)) return null;
    return s.status === "complete" ? "complete" : s.status === "open" ? "open" : null;
  } catch {
    return null;
  }
}
