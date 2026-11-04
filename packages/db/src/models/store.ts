/** Store = a local business that lists items kids can wish for. Needs admin approval. */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { imageSchema, objectId } from "./_shared.ts";

export const STORE_STATUSES = [
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
    category: { type: String, required: true, trim: true, maxlength: 60 },
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
    ownerUserId: objectId("User"),
    repUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    /** Signup acknowledgement of the discount + guarantee terms (record which version). */
    discountAgreement: {
      version: String,
      acceptedAt: Date,
      acceptedByUserId: objectId("User", false),
    },

    stripeConnectAccountId: { type: String, match: /^acct_[A-Za-z0-9]+$/ },

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
