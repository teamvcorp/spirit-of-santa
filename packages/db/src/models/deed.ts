/**
 * DeedType = admin-managed catalog of preset good deeds.
 * Deed     = one submitted deed by a kid, with a single-use QR code the recipient scans.
 *
 * QR security (@repo/deeds/qr): the QR link's token = HMAC(DEED_QR_KEY, deedId). We store only its
 * SHA-256 hash (qrTokenHash), so someone who reads the database can't forge working QR links, while
 * the server can recompute (re-show) a kid's QR. Lookup = hash the scanned token, then find by hash.
 * Single use = qrUsedAt set atomically; never valid after expiresAt (14 days, capped at season close).
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
    /** Optional one-line explanation shown under the title (admin /deeds, Phase 3 slice 4). */
    description: {
      en: { type: String, trim: true, maxlength: 200 },
      es: { type: String, trim: true, maxlength: 200 },
    },
    /** Suggested tip range shown to the person thanking the kid (never enforced on the amount). */
    recommendedTipCents: { min: centsField(false), max: centsField(false) },
    /** Inactive = hidden from families; kept because submitted deeds point at it (no delete). */
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

// Families' catalog query: find({ active: true }).sort({ sortOrder: 1, createdAt: 1 }).
deedTypeSchema.index({ active: 1, sortOrder: 1, createdAt: 1 });

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
    /**
     * "Other" text is shown on the PUBLIC QR page only once an admin approved it (children's free
     * text can contain personal details). Until then the page says "a good deed". (Phase 4.)
     */
    customReview: { type: String, enum: ["pending", "approved", "rejected"] },
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
    /** The QR code stops working after this (DEED_QR_DAYS). */
    expiresAt: Date,

    outcome: { type: String, enum: DEED_OUTCOMES },
    tipCents: centsField(false),
    confirmedAt: Date,
    /** Pay-later SMS link expiry (PAY_LATER_LINK_DAYS). Phone numbers are NOT stored. */
    payLaterExpiresAt: Date,
  },
  { timestamps: true, versionKey: false },
);

deedSchema.index({ kidId: 1, createdAt: -1 }); // a kid's recent deeds + the daily cap
deedSchema.index({ status: 1, confirmedAt: 1 }); // parents' daily summary (Phase 7)
deedSchema.index({ customReview: 1, createdAt: 1 }); // admin moderation queue

export type DeedDoc = InferSchemaType<typeof deedSchema>;
export const Deed = (models.Deed ??
  model("Deed", deedSchema)) as Model<DeedDoc>;
