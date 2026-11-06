/**
 * WishListItem = one store Item on one kid's Christmas list, plus its funding progress.
 *
 * Lifecycle (SpiritOfSanta.md Phase 6):
 *   active ──(funded == cost)──▶ fully_funded ──(30 days, ITEM_LOCK_DAYS)──▶ locked
 *     │                              │                                        │
 *     └──removed (escrow released)◀──┘ (only before lock)          shipped ─▶ delivered
 *   Dec 25 with funded < cost ──▶ unfunded (parent may pay up)
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, objectId, seasonYearField } from "./_shared.ts";

export const WISH_LIST_STATUSES = [
  "active",
  "fully_funded",
  "locked",
  "removed",
  "unfunded",
  "shipped",
  "delivered",
] as const;

const wishListItemSchema = new Schema(
  {
    kidId: objectId("Kid"),
    familyId: objectId("Family"),
    itemId: objectId("Item"),
    storeId: objectId("Store"),
    seasonYear: seasonYearField,

    /** Point cost snapshot when added (prices can't change after Apr 1 anyway). */
    costCentipoints: { ...centipointsField(), min: 1 },
    fundedCentipoints: {
      ...centipointsField(),
      default: 0,
      validate: {
        validator(this: { costCentipoints?: number }, v: number) {
          return this.costCentipoints == null || v <= this.costCentipoints;
        },
        message: "Cannot fund beyond the item cost",
      },
    },

    status: {
      type: String,
      enum: WISH_LIST_STATUSES,
      default: "active",
      required: true,
    },
    fullyFundedAt: Date, // starts the 30-day lock clock
    lockedAt: Date,
    removedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
  },
  { timestamps: true, versionKey: false },
);

wishListItemSchema.index({ kidId: 1, seasonYear: 1, status: 1 });
wishListItemSchema.index({ status: 1, fullyFundedAt: 1 }); // daily lock cron
wishListItemSchema.index({ storeId: 1, status: 1 }); // store fulfilment queue
wishListItemSchema.index({ storeId: 1, seasonYear: 1, itemId: 1 }); // store engagement totals per item
wishListItemSchema.index({ seasonYear: 1, status: 1 }); // admin dashboard season totals

export type WishListItemDoc = InferSchemaType<typeof wishListItemSchema>;
export const WishListItem = (models.WishListItem ??
  model("WishListItem", wishListItemSchema)) as Model<WishListItemDoc>;
