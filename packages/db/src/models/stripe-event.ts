/**
 * StripeEvent = log of every webhook event we've handled, keyed by Stripe's event id.
 *
 * Why: Stripe may deliver the same event more than once (retries, network blips) and in
 * any order. Before doing anything we check this log: an event already "processed" or
 * "ignored" is acknowledged without running again. ("failed" ones DO run again, which is
 * exactly what Stripe's retry is for.)
 *
 * This is the first line of duplicate defence. The real guarantee is deeper: the ledger's
 * unique idempotencyKey and Payment's unique PaymentIntent id, so even two copies racing
 * at the same instant can't credit points twice.
 *
 * Contains no card data or personal info: just ids, type and our outcome.
 * Auto-deleted after ~13 months (TTL index); the lasting record is Payment + Transaction.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;

export const STRIPE_EVENT_STATUSES = ["processed", "ignored", "failed"] as const;

const stripeEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, match: /^evt_[A-Za-z0-9]+$/ },
    type: { type: String, required: true, maxlength: 100 },
    livemode: { type: Boolean, required: true },
    /** id of event.data.object (pi_..., ch_..., dp_..., cs_...). */
    objectId: { type: String, maxlength: 100 },
    status: { type: String, enum: STRIPE_EVENT_STATUSES, required: true },
    /** Short machine-readable reason, e.g. "duplicate", "not_ours", "kid_not_found". Never secrets. */
    note: { type: String, maxlength: 300 },
    attempts: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, versionKey: false },
);

stripeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

export type StripeEventDoc = InferSchemaType<typeof stripeEventSchema>;
export const StripeEvent = (models.StripeEvent ??
  model("StripeEvent", stripeEventSchema)) as Model<StripeEventDoc>;
