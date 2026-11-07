/**
 * WishListItem = one store Item on one kid's Christmas list, plus its funding progress.
 *
 * Lifecycle (SpiritOfSanta.md Phase 6):
 *   active ──(funded == cost)──▶ fully_funded ──(next daily job: magic spent)──▶ locked
 *     │                                                                          │
 *     └──removed (escrow released; ACTIVE only)                       shipped ─▶ delivered
 *   Dec 25 with funded < cost ──▶ unfunded (parent may pay up)
 *
 * Fulfilment (year-round season, owner 2026-11-07): fully funded = SECURED. It locks at the next daily
 * job (can't be removed, magic spent) and the store HOLDS it until the December ship window (the
 * freeze date; @repo/lib/season canShipGift: last season's gifts may always ship) → "shipped" (store → Spirit of Santa) → admin marks it received (receivedAt) →
 * admin sends it to the family → "delivered" + the parent is emailed. The store never sees
 * anything about the child: only the item, a reference code and Spirit of Santa's address.
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
    /** One unit of store stock was reserved when it became fully funded (returned if removed). */
    inventoryReserved: { type: Boolean },
    /** Fully funded but the store had no stock left: store/admin must find a substitute. */
    needsSubstitute: { type: Boolean },
    lockedAt: Date,
    removedAt: Date,
    /** Dec 25 close: not fully funded → "unfunded"; its escrowed points went to Spirit of Santa. */
    forfeitedAt: Date,
    forfeitedCentipoints: { type: Number, min: 0 },
    /** The Dec 25 close failed on this gift (data needs a human); skipped until cleared. */
    closeNeedsAttentionAt: Date,
    /**
     * Lock + spend failed on BAD DATA (kid missing, escrow lower than the gift holds, amounts off): the daily job
     * skips the gift until a human fixes the data and clears this field (Phase 8, engine.ts lockFundedItems).
     */
    lockNeedsAttentionAt: Date,

    /** Daily store digest: when the store was told to set it aside / that it's ready to ship. */
    setAsideNotifiedAt: Date,
    readyNotifiedAt: Date,
    /** Admin arranged a substitute with the store (clears needsSubstitute; note is admin-typed). */
    substituteArrangedAt: Date,
    substituteNote: { type: String, trim: true, maxlength: 300 },

    shippedAt: Date, // store → Spirit of Santa
    shippedByUserId: objectId("User", false),
    /** Carrier + tracking number as typed by the store (optional). */
    trackingNote: { type: String, trim: true, maxlength: 100 },
    receivedAt: Date, // Spirit of Santa has it
    receivedByUserId: objectId("User", false),
    /**
     * What Spirit of Santa owes the store for this gift (slice 5): wholesaleCents(cost, store discount),
     * FIXED when the gift is received (a later discount change never rewrites an existing debt).
     */
    payoutOwedCents: { type: Number, min: 0 },
    /** The StorePayout that paid it (null = still owed). */
    payoutId: objectId("StorePayout", false),
    /**
     * The family deleted its account (COPPA, Phase 8) after this gift was locked: the store still ships and is
     * paid, but Spirit of Santa KEEPS the gift (no address, nobody to send it to). kidId/familyId then point at
     * deleted records (anonymised).
     */
    familyDeletedAt: Date,
    deliveredAt: Date, // sent on to the family (parent emailed)
    deliveredByUserId: objectId("User", false),
    familyNotifiedAt: Date, // the parent's "on its way" email really went out
    /** Child or family deleted before the email: nobody to tell (never retried). */
    familyNoticeSkippedAt: Date,
  },
  { timestamps: true, versionKey: false },
);

wishListItemSchema.index({ kidId: 1, seasonYear: 1, status: 1 });
wishListItemSchema.index({ status: 1, fullyFundedAt: 1 }); // daily lock cron
wishListItemSchema.index({ storeId: 1, status: 1 }); // store fulfilment queue
wishListItemSchema.index({ status: 1, receivedAt: 1 }); // admin fulfilment queue
wishListItemSchema.index({ storeId: 1, payoutId: 1, receivedAt: 1 }); // payouts owed per store
wishListItemSchema.index({ storeId: 1, seasonYear: 1, itemId: 1 }); // store engagement totals per item
wishListItemSchema.index({ seasonYear: 1, status: 1 }); // admin dashboard season totals

export type WishListItemDoc = InferSchemaType<typeof wishListItemSchema>;
export const WishListItem = (models.WishListItem ??
  model("WishListItem", wishListItemSchema)) as Model<WishListItemDoc>;
