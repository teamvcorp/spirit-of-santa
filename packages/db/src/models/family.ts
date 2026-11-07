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

    /**
     * Delivery address for funded gifts (Phase 6 slice 4b), ENCRYPTED (AES-256-GCM, ADDRESS_ENCRYPTION_KEY,
     * bound to this family's id): @repo/auth/sealed. select: false = never loaded unless a query asks
     * for "+deliveryAddressEnc" on purpose. Deleted once no gift is waiting to be delivered.
     */
    deliveryAddressEnc: { type: String, maxlength: 2000, select: false },
    deliveryAddressUpdatedAt: Date,

    /**
     * Parent email notifications (Phase 7). Missing = ON. Bookkeeping so nothing is sent twice:
     * lastDigestAt = news up to here was already emailed; *SentYear = that season's reminder went out.
     */
    notify: {
      magic: Boolean,
      deeds: Boolean,
      reminders: Boolean,
      lastDigestAt: Date,
      cutoffSentYear: Number,
      payUpSentYear: Number,
    },
    /** Optional public family alias, shown on QR pages only when showAliasPublicly is set. */
    alias: { type: String, trim: true, maxlength: 80 },
    showAliasPublicly: { type: Boolean, default: false },
    /**
     * Admin review of the nickname (admin /moderation). Shown publicly only when "approved" AND
     * switched on: a parent could otherwise publish their real surname or something offensive.
     * Changing the text sets it back to "pending".
     */
    aliasReview: { type: String, enum: ["pending", "approved", "rejected"] },
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
