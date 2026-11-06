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
    /** PRIVATE (parent's own pages only). Public QR pages never show it (Phase 4 decision). */
    familyName: { type: String, required: true, trim: true, maxlength: 80 },
    /** Optional public family alias, shown on QR pages only when showAliasPublicly is set. */
    alias: { type: String, trim: true, maxlength: 80 },
    showAliasPublicly: { type: Boolean, default: false },
    /** US ZIP for zip-targeted corporate donations. */
    zip: { type: String, match: /^\d{5}$/ },

    /**
     * Parental consent record (COPPA). Sign-up stores the policy version the parent agreed to;
     * confirming the email sets emailVerifiedAt. Each kid is then registered with a card payment
     * (Phase 4 slice 2) as the stronger, card-based verification. Kept for as long as the family is.
     */
    consent: {
      version: { type: String, maxlength: 40 },
      acceptedAt: Date,
      emailVerifiedAt: Date,
    },

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
