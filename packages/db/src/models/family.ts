/**
 * Family = one parent account plus its kids.
 * The parent PIN guards the parent dashboard (item caps, bonus magic, Naughty/Nice vote)
 * from kids using the same signed-in device. It's checked separately from the login session.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { hideFields, objectId } from "./_shared.ts";

const familySchema = new Schema(
  {
    ownerUserId: { ...objectId("User"), unique: true },
    familyName: { type: String, required: true, trim: true, maxlength: 80 },
    /** Shown on public QR pages instead of the family name when showAliasPublicly is set. */
    alias: { type: String, trim: true, maxlength: 80 },
    showAliasPublicly: { type: Boolean, default: false },
    /** US ZIP for zip-targeted corporate donations. */
    zip: { type: String, match: /^\d{5}$/ },

    /** argon2id hash of the 4–6 digit parent PIN. */
    parentPinHash: { type: String, select: false },
    pinFailedCount: { type: Number, default: 0, min: 0, select: false },
    pinLockedUntil: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: hideFields("parentPinHash", "pinFailedCount", "pinLockedUntil"),
  },
);

export type FamilyDoc = InferSchemaType<typeof familySchema>;
export const Family = (models.Family ??
  model("Family", familySchema)) as Model<FamilyDoc>;
