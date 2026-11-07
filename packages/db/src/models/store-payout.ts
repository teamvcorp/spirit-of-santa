/**
 * StorePayout = one payment Spirit O Santa made to a store, OUTSIDE the app (check, bank transfer):
 * roadmap "store payouts recorded by admin (no Stripe Connect)" (Phase 6 slice 5).
 * It covers specific received gifts (WishListItem.payoutId points here), so every dollar paid can be
 * traced to the gifts it paid for. Append-only in practice: a mistake is fixed by an admin note +
 * a correcting record, never by editing history (no update/delete path in the app).
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centsField, objectId, seasonYearField } from "./_shared.ts";

export const PAYOUT_METHODS = ["check", "bank_transfer", "other"] as const;

const storePayoutSchema = new Schema(
  {
    storeId: objectId("Store"),
    seasonYear: seasonYearField,
    /** Sum of the covered gifts' payoutOwedCents (computed by the server, never typed). */
    amountCents: { ...centsField(), min: 1 },
    giftCount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYOUT_METHODS, required: true },
    /** Check number / transfer reference (admin-typed, optional). */
    reference: { type: String, trim: true, maxlength: 60 },
    /** The day the money was sent (admin-chosen, ISO yyyy-mm-dd, Central Time calendar day). */
    paidOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    note: { type: String, trim: true, maxlength: 300 },
    createdByUserId: objectId("User"),
  },
  { timestamps: true, versionKey: false },
);

storePayoutSchema.index({ storeId: 1, createdAt: -1 });
storePayoutSchema.index({ seasonYear: 1, createdAt: -1 });

export type StorePayoutDoc = InferSchemaType<typeof storePayoutSchema>;
export const StorePayout = (models.StorePayout ?? model("StorePayout", storePayoutSchema)) as Model<StorePayoutDoc>;
