/**
 * Payment = one MONEY record per Stripe PaymentIntent (tips, parent bonuses, donations,
 * pay-ups). It's the money side of the books; Transaction is the points side.
 *
 *   Transaction (ledger)  → what each kid earned/spent in points. Append-only.
 *   Payment (this)        → what money came in, what happened to it afterwards
 *                           (refund, chargeback), and whether points were credited.
 *
 * Margin reporting (docs/CODEMAP.md "Platform margin") sums amountCents here, minus
 * refundedCents and lost disputes, minus store payouts.
 *
 * Written ONLY by the Stripe webhook (packages/payments). Unlike the ledger it is mutable
 * (status, refund and dispute fields change as Stripe tells us things), but points never
 * change because of those updates: Spirit O Santa has a NO-REFUNDS policy (user decision
 * 2026-11-05), so refunds/chargebacks are recorded and flagged for admin, not clawed back.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, centsField, objectId, seasonYearField } from "./_shared.ts";

/** What the money was for. Set by OUR server in PaymentIntent metadata, never by the payer. */
export const PAYMENT_PURPOSES = ["tip", "bonus", "donation", "payup", "registration"] as const;
export const PAYMENT_STATUSES = ["succeeded", "failed", "canceled"] as const;
/**
 * credited = points added to the kid's ledger.
 * held     = money recorded, points not handled yet (donation split / pay-up lock are
 *            built in Phases 5–6; they'll pick up "held" payments).
 * review   = something didn't add up (kid missing, wrong family, odd amount): an admin decides.
 * none     = no points involved (failed/canceled payments).
 * fulfilled = done, no points involved (child registrations: the kids were marked registered).
 */
/** retained = community-donation money never shared, kept by the platform at season end (Jan 1 job). */
export const PAYMENT_FULFILMENTS = ["credited", "held", "review", "none", "fulfilled", "retained"] as const;

const paymentSchema = new Schema(
  {
    stripePaymentIntentId: { type: String, required: true, unique: true, match: /^pi_[A-Za-z0-9]+$/ },
    livemode: { type: Boolean, required: true },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    seasonYear: seasonYearField,

    kidId: objectId("Kid", false),

    /** Registration payments cover several kids at once. */
    kidIds: { type: [objectId("Kid")], default: undefined },
    familyId: objectId("Family", false),
    deedId: objectId("Deed", false),
    wishListItemId: objectId("WishListItem", false),
    /** Community donation: the split run that shared it (fulfilment then "credited"). */
    splitId: objectId("DonationSplit", false),
    /** When the money arrived (first payment_intent.succeeded we processed). Receipt date. */
    succeededAt: Date,
    /** Community donation (/donate) aimed at one US ZIP; absent = the "all kids" pool. */
    zip: { type: String, match: /^\d{5}$/ },

    /** Money actually received (PaymentIntent.amount_received), USD cents. */
    amountCents: centsField(),
    // We only create USD payments, but record whatever Stripe reports (lowercase ISO code) so
    // an unexpected currency lands in "review" instead of failing validation forever.
    currency: { type: String, required: true, match: /^[a-z]{3}$/ },

    fulfilment: { type: String, enum: PAYMENT_FULFILMENTS, required: true },
    pointsCreditedCentipoints: { ...centipointsField(), default: 0 },

    /** Total refunded so far (Charge.amount_refunded). Should stay 0: no-refunds policy. */
    refundedCents: { ...centsField(), default: 0 },
    dispute: {
      stripeDisputeId: { type: String, match: /^(dp|du)_[A-Za-z0-9]+$/ },
      status: { type: String, maxlength: 40 }, // Stripe's value, e.g. needs_response, won, lost
      amountCents: centsField(false),
    },

    /** Admin attention needed (refund, dispute, failed checks). Cleared by an admin. */
    needsReview: { type: Boolean, default: false },
    reviewReason: { type: String, maxlength: 300 },

    checkoutSessionId: { type: String, match: /^cs_[A-Za-z0-9_]+$/ },
    paymentLinkId: { type: String, match: /^plink_[A-Za-z0-9]+$/ },
  },
  { timestamps: true, versionKey: false },
);

paymentSchema.index({ seasonYear: 1, purpose: 1 }); // margin reports
paymentSchema.index({ needsReview: 1, updatedAt: -1 }, { partialFilterExpression: { needsReview: true } });
paymentSchema.index({ fulfilment: 1 }, { partialFilterExpression: { fulfilment: "held" } });
paymentSchema.index({ kidId: 1, createdAt: -1 });

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;
export const Payment = (models.Payment ?? model("Payment", paymentSchema)) as Model<PaymentDoc>;
