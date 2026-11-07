/**
 * Store = a local business that lists items kids can wish for. Needs admin approval.
 *
 * Status flow:  invited (admin sent an invite, owner hasn't accepted yet)
 *               pending (self-registered, waiting for admin)  → approved | rejected
 *               approved ⇄ suspended
 * Pending/invited stores may already set up their profile and items (user decision
 * 2026-11-05); families only ever see APPROVED stores.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { MAX_DISCOUNT_BPS, STORE_CATEGORIES } from "@repo/lib/store";
import { imageSchema, objectId } from "./_shared.ts";

export const STORE_STATUSES = [
  "invited",
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

const storeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** URL-safe unique handle, e.g. "storm-lake-toys". */
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^[a-z0-9-]{3,60}$/,
    },
    category: { type: String, required: true, enum: STORE_CATEGORIES },
    description: { type: String, trim: true, maxlength: 2000 },
    photos: {
      type: [imageSchema],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= 10,
        message: "Max 10 photos",
      },
    },
    contact: {
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        maxlength: 254,
      },
      phone: { type: String, trim: true, maxlength: 30 },
      website: {
        type: String,
        trim: true,
        maxlength: 300,
        match: /^https:\/\//,
      },
      address: {
        line1: { type: String, trim: true, maxlength: 120 },
        city: { type: String, trim: true, maxlength: 60 },
        state: { type: String, uppercase: true, match: /^[A-Z]{2}$/ },
        zip: { type: String, match: /^\d{5}$/ },
      },
    },

    status: {
      type: String,
      enum: STORE_STATUSES,
      default: "pending",
      required: true,
      index: true,
    },
    /** Required except while "invited" (the owner account is created when they accept). */
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [
        function (this: { status?: string }) {
          return this.status !== "invited";
        },
        "ownerUserId is required once the store is not just invited",
      ],
    },
    repUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    /**
     * Discount off retail agreed with admin, in basis points (2000 = 20%). Set at approval
     * (or in the invite). Wholesale owed per item = wholesaleCents(price, discountBps).
     */
    discountBps: {
      type: Number,
      min: 0,
      max: MAX_DISCOUNT_BPS,
      validate: { validator: (v: unknown) => v == null || Number.isSafeInteger(v), message: "discountBps must be an integer" },
    },

    /** Signup acknowledgement of the discount + guarantee terms (record which version). */
    discountAgreement: {
      version: String,
      acceptedAt: Date,
      acceptedByUserId: objectId("User", false),
    },

    // No Stripe Connect (decided 2026-11-04): stores are paid by check or other means
    // outside the app, so we store no bank or Stripe account details for them.

    /**
     * Write counter used ONLY as a lock for the per-season item limit (packages/stores/items.ts).
     * Every item add/restore bumps it inside its transaction; MongoDB lets only one transaction
     * write this document at a time, so two simultaneous adds can't both see "49 items" and both
     * insert. The number itself means nothing.
     */
    itemLockSeq: { type: Number, default: 0, select: false },
    /** Season whose Jan 1 catalogue copy is done for this store (@repo/stores/catalog-rollover; copied or skipped). */
    catalogCopiedYear: { type: Number },

    invitedByAdminId: objectId("User", false),
    reviewedByAdminId: objectId("User", false),
    reviewedAt: Date,
    rejectionReason: { type: String, maxlength: 500 },
  },
  { timestamps: true, versionKey: false },
);

export type StoreDoc = InferSchemaType<typeof storeSchema>;
export const Store = (models.Store ??
  model("Store", storeSchema)) as Model<StoreDoc>;
