/**
 * PayLaterRequest = one "Pay later by text" request for a deed (Phase 5 slice 4b). The consent
 * RECORD the carriers expect (number, time, wording version + language) and the state of the one
 * text we sent. Registered with the carriers (docs/vendor/twilio.md): exactly one text per request.
 *
 * - One ACTIVE request per deed (partial unique index on deedId where active: true): a second
 *   request is refused while one is live; a failed/expired/closed one is no longer active, so
 *   the deed can try again (still limited per number).
 * - phoneKey = HMAC of the number (per-number daily limit). The full number is kept only to prove
 *   consent; the whole record is deleted 13 months after it was created (TTL), as /privacy says.
 * - status: creating → sending (text being sent) → sent → paid | expired | closed (deed thanked or
 *   paid another way); or failed (Stripe/text failed: link switched off). "sending" = possibly
 *   delivered, treated as sent.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centsField, objectId } from "./_shared.ts";

export const PAY_LATER_STATUSES = ["creating", "sending", "sent", "paid", "expired", "closed", "failed"] as const;
/** 13 months (≈ 395 days), stated in the privacy policy. */
const KEEP_SECONDS = 395 * 24 * 3600;

const payLaterRequestSchema = new Schema(
  {
    deedId: objectId("Deed"),
    /** true while the request is live (creating/sending/sent); unset when it ends. */
    active: { type: Boolean },
    kidId: objectId("Kid"),
    familyId: objectId("Family"),
    phoneE164: { type: String, required: true, match: /^\+1\d{10}$/ },
    phoneKey: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    consentAt: { type: Date, required: true },
    consentVersion: { type: String, required: true, maxlength: 40 },
    consentLocale: { type: String, enum: ["en", "es"], required: true },
    amountCents: centsField(),
    status: { type: String, enum: PAY_LATER_STATUSES, default: "creating" },
    /** When the link stops working (≤ 7 days, deed expiry, season close). */
    expiresAt: { type: Date, required: true },
    paymentLinkId: { type: String, match: /^plink_[A-Za-z0-9]+$/ },
    paymentLinkUrl: { type: String, maxlength: 300 },
    smsSid: { type: String, maxlength: 64 },
    /** Twilio error code / "stripe" when failed. */
    error: { type: String, maxlength: 40 },
  },
  { timestamps: true, versionKey: false },
);

payLaterRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_SECONDS }); // privacy: deleted after 13 months
payLaterRequestSchema.index({ deedId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "deedId_active_unique" }); // one live request per deed
payLaterRequestSchema.index({ phoneKey: 1, createdAt: -1 }); // per-number daily limit
payLaterRequestSchema.index({ status: 1, expiresAt: 1 }); // daily expiry job
payLaterRequestSchema.index({ paymentLinkId: 1 }, { sparse: true }); // webhook: link paid

export type PayLaterRequestDoc = InferSchemaType<typeof payLaterRequestSchema>;
export const PayLaterRequest = (models.PayLaterRequest ?? model("PayLaterRequest", payLaterRequestSchema)) as Model<PayLaterRequestDoc>;
