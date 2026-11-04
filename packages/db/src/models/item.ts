/**
 * Item = a product a store lists for one season.
 * Limits enforced by the server action, not here (they need a count/date check):
 *   STORE_ITEM_LIMIT (50) per store per season; edits only while isStoreItemWindowOpen().
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import {
  centsField,
  imageSchema,
  objectId,
  seasonYearField,
} from "./_shared.ts";

export const ITEM_STATUSES = ["active", "archived"] as const;

const itemSchema = new Schema(
  {
    storeId: objectId("Store"),
    seasonYear: seasonYearField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: String, trim: true, maxlength: 60 },
    photo: imageSchema,

    /** Retail price. Its point cost is the same number in centipoints. */
    priceCents: { ...centsField(), min: 1 },
    /** What Spirit O Santa pays the store (after the agreed discount). Must be <= price. */
    payoutCents: {
      ...centsField(false),
      validate: {
        validator(this: { priceCents?: number }, v: number | null | undefined) {
          // `this` is the document on save(); for update validators set via the service.
          return v == null || this.priceCents == null || v <= this.priceCents;
        },
        message: "payoutCents cannot exceed priceCents",
      },
    },
    inventory: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ITEM_STATUSES,
      default: "active",
      required: true,
    },

    /** Engagement matrix for store dashboards. */
    stats: {
      impressions: { type: Number, default: 0, min: 0 },
      wishListAdds: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true, versionKey: false },
);

itemSchema.index({ storeId: 1, seasonYear: 1, status: 1 });
itemSchema.index({ name: "text", description: "text" }); // national item search (Phase 6)

export type ItemDoc = InferSchemaType<typeof itemSchema>;
export const Item = (models.Item ??
  model("Item", itemSchema)) as Model<ItemDoc>;
