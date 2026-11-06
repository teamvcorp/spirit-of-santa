/**
 * DonationReceipt = the tax receipt for ONE community donation (/donate), Phase 5 slice 2.
 * Created when the donation payment is recorded (webhook or return page), sent by email once the
 * admin has switched receipts on and filled in the charity details. Unique per PaymentIntent, so
 * a replayed webhook never makes a second receipt.
 *
 * Donor email + name come from Stripe Checkout (what the donor typed there). Kept so a receipt can
 * be re-sent and for the charity's records; a donor is an adult, never a child.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centsField, seasonYearField } from "./_shared.ts";

export const DONATION_RECEIPT_STATUSES = ["pending", "sent", "failed"] as const;

const donationReceiptSchema = new Schema(
  {
    stripePaymentIntentId: { type: String, required: true, unique: true, match: /^pi_[A-Za-z0-9]+$/ },
    /** Shown on the receipt, e.g. "SOS-2026-3UYQFQFO". */
    receiptNo: { type: String, required: true, unique: true, match: /^SOS-\d{4}-[A-Z0-9]{6,24}$/ },
    seasonYear: seasonYearField,
    amountCents: centsField(),
    donatedAt: { type: Date, required: true },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    donorName: { type: String, trim: true, maxlength: 120 },
    locale: { type: String, enum: ["en", "es"], default: "en" },
    /** The family app's /donate page, set where the receipt was created (a link in the email). */
    link: { type: String, maxlength: 300 },
    status: { type: String, enum: DONATION_RECEIPT_STATUSES, default: "pending" },
    /** The charity as named on the receipt WHEN SENT (later settings changes don't rewrite it). */
    issuer: {
      legalName: { type: String, maxlength: 120 },
      ein: { type: String, match: /^\d{2}-\d{7}$/ },
      address: { type: String, maxlength: 200 },
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, maxlength: 200 },
    sentAt: Date,
  },
  { timestamps: true, versionKey: false },
);

donationReceiptSchema.index({ status: 1, createdAt: 1 }); // "send everything still pending"

export type DonationReceiptDoc = InferSchemaType<typeof donationReceiptSchema>;
export const DonationReceipt = (models.DonationReceipt ?? model("DonationReceipt", donationReceiptSchema)) as Model<DonationReceiptDoc>;
