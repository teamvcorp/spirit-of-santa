/**
 * Kid = a child profile inside a Family. COPPA: collect only what we need
 * (first name + birth date for age checks). No email, photo, surname or address.
 *
 * Balances are a CACHE of the Transaction ledger. Only the ledger service may change them,
 * and only inside the same DB transaction that inserts the matching ledger rows, so
 *   available + escrowed == sum(ledger for this kid this season)   always holds.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, objectId } from "./_shared.ts";

const kidSchema = new Schema(
  {
    familyId: { ...objectId("Family"), index: true },
    firstName: { type: String, required: true, trim: true, maxlength: 40 },
    birthDate: { type: Date, required: true },
    /** Parent-set max number of items on this kid's wish list. */
    itemCap: { type: Number, default: 5, min: 0, max: 50 },

    availableCentipoints: { ...centipointsField(), default: 0 },
    escrowedCentipoints: { ...centipointsField(), default: 0 },

    archivedAt: Date, // soft delete; hard delete on parent request (COPPA deletion right)
  },
  { timestamps: true, versionKey: false },
);

export type KidDoc = InferSchemaType<typeof kidSchema>;
export const Kid = (models.Kid ?? model("Kid", kidSchema)) as Model<KidDoc>;
