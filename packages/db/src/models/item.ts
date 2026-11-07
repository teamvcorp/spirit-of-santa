/**
 * Item = a product a store lists for one season.
 * Limits enforced by the server action, not here (they need a count/date check):
 *   STORE_ITEM_LIMIT (50) per store per season; edits only while the store item window is open
 *   (getSeasonState() in @repo/stores/season: it includes the admin's open/closed switch).
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

/**
 * draft    = created by a rep, waiting for the owner to set a price (not shown to families).
 * active   = priced and listed (families see it once the store is approved).
 * archived = removed from the list; kept for history and doesn't count toward the 50.
 */
export const ITEM_STATUSES = ["draft", "active", "archived"] as const;

const itemSchema = new Schema(
  {
    storeId: objectId("Store"),
    seasonYear: seasonYearField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: String, trim: true, maxlength: 60 },
    photo: imageSchema,

    /** Retail price. Its point cost is the same number in centipoints. */
    priceCents: {
      ...centsField(false),
      min: 1,
      // A price is required unless the item is a rep's draft awaiting the owner's price.
      required: [
        function (this: { status?: string }) {
          return this.status !== "draft";
        },
        "priceCents is required unless the item is a draft",
      ],
    },
    /** What Spirit of Santa pays the store (after the agreed discount). Must be <= price. */
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
    /** Set on the Jan 1 copy of last season's item (@repo/stores/catalog-rollover): the source item. Unique = idempotent copy. */
    copiedFromItemId: objectId("Item", false),
    status: {
      type: String,
      enum: ITEM_STATUSES,
      default: "active",
      required: true,
    },

    /**
     * Engagement counters for store dashboards (slice 5, user decisions 2026-11-05).
     * views = item page opened by a family, counted at most once per visitor per day
     *         (recordItemView in packages/stores/src/engagement.ts).
     * Wish-list numbers are NOT counters: they're computed from WishListItem records,
     * so they can never drift out of sync.
     */
    stats: {
      views: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true, versionKey: false },
);

itemSchema.index({ storeId: 1, seasonYear: 1, status: 1 });
itemSchema.index({ seasonYear: 1, status: 1 }); // admin dashboard season totals
// One copy per source item, ever (a retried or concurrent Jan 1 run can't duplicate). Partial: most items aren't copies.
itemSchema.index({ copiedFromItemId: 1 }, { unique: true, partialFilterExpression: { copiedFromItemId: { $exists: true } } });
itemSchema.index({ "photo.pathname": 1 }, { partialFilterExpression: { "photo.pathname": { $exists: true } } }); // shared-photo check
itemSchema.index({ name: "text", description: "text" }); // national item search (Phase 6)

export type ItemDoc = InferSchemaType<typeof itemSchema>;
export const Item = (models.Item ??
  model("Item", itemSchema)) as Model<ItemDoc>;
