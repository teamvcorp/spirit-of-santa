/**
 * Status of a Checkout session when the payer comes BACK from Stripe (registration, QR tips,
 * donation links, parent bonuses). SERVER-ONLY. One copy of the logic every return page needs.
 *
 *  - `belongs` decides, from Stripe's OWN session metadata (set with our secret key, so the payer
 *    can't forge it), whether this caller may see the session (their family / deed / kid). Anything
 *    else → null: we never confirm or describe someone else's payment.
 *  - Paid → recorded right away with the webhook's idempotent handler (fulfilPaidPaymentIntent), so a
 *    late or missing webhook never leaves the payer looking at "processing".
 *  - Never throws: any Stripe/DB error → null ("we couldn't find that payment").
 */
import "server-only";
import { connectDb, Payment } from "@repo/db";
import { getStripe } from "./client.ts";
import { fulfilPaidPaymentIntent } from "./fulfil.ts";

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export type ReturnResult = { state: "open" } | { state: "processing" } | { state: "done"; fulfilment: string };

export async function checkoutReturnStatus(
  sessionId: string,
  belongs: (metadata: Record<string, string>) => boolean | Promise<boolean>,
): Promise<ReturnResult | null> {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (!(await belongs(s.metadata ?? {}))) return null;
    if (s.status === "open") return { state: "open" };
    if (s.status !== "complete") return null;
    const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
    if (piId && s.payment_status === "paid") {
      await fulfilPaidPaymentIntent(piId).catch((e: unknown) => console.error("[return] fulfil failed:", e instanceof Error ? e.name : "unknown"));
    }
    await connectDb();
    const pay = piId ? await Payment.findOne({ stripePaymentIntentId: piId }).select("fulfilment").lean() : null;
    return pay ? { state: "done", fulfilment: String(pay.fulfilment) } : { state: "processing" };
  } catch {
    return null;
  }
}

/** For point-crediting purposes (tip, donation link, bonus): the 4 states the return pages show. */
export function creditReturnState(r: ReturnResult | null): "credited" | "processing" | "review" | "open" | null {
  if (!r) return null;
  if (r.state !== "done") return r.state;
  return r.fulfilment === "credited" ? "credited" : "review";
}
