/**
 * DeedType = admin-managed catalog of preset good deeds.
 * Deed     = one submitted deed by a kid, with a single-use QR code the recipient scans.
 *
 * QR security: the QR encodes a random 32-byte token. We store only its SHA-256 hash
 * (qrTokenHash), so someone who reads the database still can't forge working QR links.
 * Lookup = hash the scanned token, then find by hash. Single-use = qrUsedAt set atomically.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { LOCALES, centsField, objectId, seasonYearField } from "./_shared.ts";

// ── DeedType (catalog) ───────────────────────────────────────────────────────────────
const deedTypeSchema = new Schema(
  {
    title: {
      en: { type: String, required: true, trim: true, maxlength: 100 },
      es: { type: String, trim: true, maxlength: 100 },
    },
    recommendedTipCents: { min: centsField(false), max: centsField(false) },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

export type DeedTypeDoc = InferSchemaType<typeof deedTypeSchema>;
export const DeedType = (models.DeedType ??
  model("DeedType", deedTypeSchema)) as Model<DeedTypeDoc>;

// ── Deed (submission) ────────────────────────────────────────────────────────────────
export const DEED_STATUSES = [
  "pending",
  "confirmed",
  "expired",
  "flagged",
  "rejected",
] as const;
/** Recipient's choice on the QR page. */
export const DEED_OUTCOMES = ["paid", "thanked", "pay_later"] as const;

const deedSchema = new Schema(
  {
    kidId: { ...objectId("Kid"), index: true },
    familyId: objectId("Family"),
    seasonYear: seasonYearField,
    deedTypeId: objectId("DeedType", false),
    /** Free text for "Other". Goes through the admin moderation queue. */
    // Conditional `required` (not a pre-validate hook) so it runs in validate(),
    // validateSync() and update validators alike.
    customDescription: {
      type: String,
      trim: true,
      maxlength: 280,
      required: [
        function (this: { deedTypeId?: unknown }) {
          return !this.deedTypeId; // a deed must name a catalog type or describe itself
        },
        "Pick a deed type or describe the deed",
      ],
    },
    locale: { type: String, enum: LOCALES, default: "en" },

    status: {
      type: String,
      enum: DEED_STATUSES,
      default: "pending",
      required: true,
    },
    qrTokenHash: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    qrUsedAt: Date,

    outcome: { type: String, enum: DEED_OUTCOMES },
    tipCents: centsField(false),
    confirmedAt: Date,
    /** Pay-later SMS link expiry (PAY_LATER_LINK_DAYS). Phone numbers are NOT stored. */
    payLaterExpiresAt: Date,
  },
  { timestamps: true, versionKey: false },
);

export type DeedDoc = InferSchemaType<typeof deedSchema>;
export const Deed = (models.Deed ??
  model("Deed", deedSchema)) as Model<DeedDoc>;
