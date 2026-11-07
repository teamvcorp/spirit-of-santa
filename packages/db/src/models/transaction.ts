/**
 * Transaction = the points LEDGER. Every point earned, escrowed, released, spent or reset
 * is one immutable row. Kid balances are a cache derived from these rows.
 *
 * Append-only: middleware below rejects updates/deletes made through Mongoose. That's a
 * guard against bugs, not attackers. Real enforcement is a MongoDB Atlas DB user whose role
 * allows only `find` + `insert` on this collection (see docs/CODEMAP.md, "Security TODO").
 * Corrections are new "adjustment" rows, never edits.
 *
 * Idempotency: Stripe webhooks can arrive more than once. Callers set idempotencyKey
 * (e.g. `${paymentIntentId}:${kidId}`); the unique index makes a duplicate insert fail
 * instead of double-crediting points.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import {
  centipointsField,
  centsField,
  objectId,
  seasonYearField,
} from "./_shared.ts";

/**
 * How each type moves a kid's balance (amount is always positive):
 *   earn_*        +available           (money came in: tip, parent bonus, donation)
 *   escrow        available → escrowed (item added to wish list)
 *   release       escrowed  → available(item removed before lock)
 *   spend         −escrowed            (item locked & sent for fulfilment)
 *   season_reset  −available           (Jan 1 reset)
 *   adjustment_*  ±available           (admin correction; note required)
 */
export const TRANSACTION_TYPES = [
  "earn_tip",
  "earn_bonus",
  "earn_donation",
  /** Parent paid to finish a gift during the pay-up window (Phase 6 slice 4). */
  "earn_payup",
  "escrow",
  /** Dec 25: points on a gift that wasn't fully funded go to Spirit O Santa (user decision 2026-11-06). */
  "forfeit",
  "release",
  "spend",
  "season_reset",
  "adjustment_credit",
  "adjustment_debit",
] as const;

const transactionSchema = new Schema(
  {
    kidId: { ...objectId("Kid"), index: true },
    familyId: objectId("Family"),
    seasonYear: seasonYearField,
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amountCentipoints: { ...centipointsField(), min: 1 },
    /** Money behind an earn_* row, for reconciliation with Stripe. */
    cents: centsField(false),

    deedId: objectId("Deed", false),
    wishListItemId: objectId("WishListItem", false),
    stripePaymentIntentId: { type: String, match: /^pi_[A-Za-z0-9]+$/ },
    idempotencyKey: { type: String, maxlength: 200 },

    createdByUserId: objectId("User", false), // set for parent/admin-initiated rows
    note: {
      type: String,
      maxlength: 500,
      // Admin corrections must say why (audit trail). Conditional required runs on every
      // validation path, unlike a pre("validate") hook which validateSync() skips.
      required: [
        function (this: { type?: string }) {
          return this.type?.startsWith("adjustment_") ?? false;
        },
        "Adjustments require a note explaining why",
      ],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

transactionSchema.index({ kidId: 1, seasonYear: 1, createdAt: -1 });
transactionSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

// ── Append-only guards ───────────────────────────────────────────────────────────────
const appendOnly = () => {
  throw new Error(
    "Ledger transactions are append-only; insert an adjustment instead",
  );
};
transactionSchema.pre("save", function () {
  if (!this.isNew) appendOnly();
});
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  transactionSchema.pre(op, appendOnly);
}
// bulkWrite skips query middleware, so forbid it at the model level too.
transactionSchema.pre("bulkWrite", appendOnly);

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;
export const Transaction = (models.Transaction ??
  model("Transaction", transactionSchema)) as Model<TransactionDoc>;
