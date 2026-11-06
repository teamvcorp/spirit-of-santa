/**
 * The "payment label" contract: which metadata OUR server attaches to every Stripe
 * PaymentIntent (and to Payment Links / Checkout Sessions via payment_intent_data.metadata),
 * and how the webhook reads it back.
 *
 * Why metadata is trustworthy: only a holder of our SECRET key can set or change
 * PaymentIntent metadata. A payer confirming a payment in the browser (with the
 * client_secret) cannot edit it. So the webhook can rely on "this tip is for kid X",
 * but we still re-check everything against the database (kid exists, belongs to the
 * family, deed matches) because a bug on our side could still produce bad labels.
 *
 * Stripe metadata values are strings (max 500 chars, 50 keys). Keys are prefixed `sos_`
 * so they never collide with anything else on the account, and `sos_v` lets us change
 * the format later without misreading old payments.
 *
 * Use buildPaymentMetadata() when creating payments (Phases 4–5); never hand-write keys.
 */
import "server-only";
import { z } from "zod";

export const PAYMENT_METADATA_VERSION = "1";

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "must be a 24-char hex ObjectId");
const version = z.literal(PAYMENT_METADATA_VERSION);

/** One schema per purpose; z.object strips unknown keys (other metadata is ignored). */
export const paymentMetadataSchema = z.discriminatedUnion("sos_purpose", [
  // Community tip from a deed QR page (sos_deed_id) or a family's donation QR (no deed).
  z.object({
    sos_v: version,
    sos_purpose: z.literal("tip"),
    sos_kid_id: objectId,
    sos_family_id: objectId,
    sos_deed_id: objectId.optional(),
  }),
  // Parent "bonus magic" for one of their kids.
  z.object({
    sos_v: version,
    sos_purpose: z.literal("bonus"),
    sos_kid_id: objectId,
    sos_family_id: objectId,
  }),
  // Community/corporate donation (/donate): pooled, split EQUALLY at the Dec 1 freeze; optionally one ZIP.
  z.object({
    sos_v: version,
    sos_purpose: z.literal("donation"),
    sos_zip: z.string().regex(/^\d{5}$/).optional(),
    /** Donor's page language: the tax receipt email is sent in it. */
    sos_locale: z.enum(["en", "es"]).optional(),
  }),
  // $5 child registration (parental-consent card check). Up to 10 kids, comma-separated ids.
  // sos_promo "1" = family promo code: one $5 covers every listed kid.
  z.object({
    sos_v: version,
    sos_purpose: z.literal("registration"),
    sos_family_id: objectId,
    sos_kid_ids: z.string().regex(/^[a-f0-9]{24}(,[a-f0-9]{24}){0,9}$/),
    sos_promo: z.enum(["0", "1"]),
  }),
  // Parent pay-up covering an item's funding gap (Phase 5/6 locks the item).
  z.object({
    sos_v: version,
    sos_purpose: z.literal("payup"),
    sos_kid_id: objectId,
    sos_family_id: objectId,
    sos_wish_list_item_id: objectId,
  }),
]);

export type PaymentMetadata = z.infer<typeof paymentMetadataSchema>;
export type PaymentPurpose = PaymentMetadata["sos_purpose"];

/** Distributive Omit, so each purpose keeps its own required fields. */
type WithoutVersion<T> = T extends unknown ? Omit<T, "sos_v"> : never;

/** Build the metadata object for stripe.paymentIntents.create({ metadata }). */
export function buildPaymentMetadata(input: WithoutVersion<PaymentMetadata>): Record<string, string> {
  // Parse (not just cast) so a bad id fails HERE, at creation, not silently in the webhook.
  const parsed = paymentMetadataSchema.parse({ ...input, sos_v: PAYMENT_METADATA_VERSION });
  return Object.fromEntries(
    Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

/** Read metadata from a Stripe object. null = not a Spirit O Santa payment (or malformed). */
export function parsePaymentMetadata(
  metadata: Record<string, string> | null | undefined,
): PaymentMetadata | null {
  const result = paymentMetadataSchema.safeParse(metadata ?? {});
  return result.success ? result.data : null;
}
