/**
 * Kid = a child profile inside a Family. COPPA: collect only what we need (user decision
 * 2026-11-05): first name + BIRTH YEAR (age checks), and a parent-chosen DISPLAY NAME that is the
 * only thing public pages ever show. No email, photo, surname, birthday or address.
 * A kid is "awaiting" until the $5 card registration (parental-consent verification) is done;
 * nothing about an awaiting kid appears on any public page.
 *
 * Balances are a CACHE of the Transaction ledger. Only the ledger service may change them,
 * and only inside the same DB transaction that inserts the matching ledger rows, so (all seasons):
 *   available + escrowed == Σearn_* − Σseason_reset − Σforfeit − Σspend + Σadjustment_credit − Σadjustment_debit
 *   escrowed             == Σ fundedCentipoints of the kid's active + fully_funded gifts
 * (checked by @repo/wishlists/ledger-check). Before Phase 8 (2026-11) lock booked no "spend", so escrow kept
 * growing: scripts/backfill-spend-at-lock.ts corrects old data.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, objectId } from "./_shared.ts";

const kidSchema = new Schema(
  {
    familyId: { ...objectId("Family"), index: true },
    /** PRIVATE: shown only inside the family's own signed-in pages. */
    firstName: { type: String, required: true, trim: true, maxlength: 40 },
    birthYear: { type: Number, required: true, min: 2000, max: 2100 },
    /** PUBLIC (QR pages): what strangers see. Defaults to the first initial, e.g. "M.". */
    displayName: { type: String, required: true, trim: true, maxlength: 20 },
    /** Parental-consent registration ($5 card payment, Phase 4 slice 2b). */
    registration: {
      status: { type: String, enum: ["awaiting", "registered"], default: "awaiting", required: true },
      registeredAt: Date,
      /** "card" (paid) or "promo" (family's first kid paid; promo covers the rest). */
      method: { type: String, enum: ["card", "promo"] },
    },
    /** Parent-set max number of items on this kid's wish list. */
    itemCap: { type: Number, default: 5, min: 0, max: 50 },

    /**
     * Shareable donation link (Phase 4 slice 6): token = HMAC(DEED_QR_KEY, "donate|kidId|version");
     * only its SHA-256 is stored. "Make a new link" bumps the version: the old link stops working.
     */
    donationTokenHash: { type: String, select: false, match: /^[a-f0-9]{64}$/ },
    donationLinkVersion: { type: Number, default: 1, min: 1 },

    availableCentipoints: { ...centipointsField(), default: 0 },
    escrowedCentipoints: { ...centipointsField(), default: 0 },

    archivedAt: Date, // soft delete; hard delete on parent request (COPPA deletion right)
  },
  { timestamps: true, versionKey: false },
);

// Lookup when a donation link is opened (sparse: kids without a link yet aren't indexed).
kidSchema.index({ donationTokenHash: 1 }, { unique: true, sparse: true });

export type KidDoc = InferSchemaType<typeof kidSchema>;
export const Kid = (models.Kid ?? model("Kid", kidSchema)) as Model<KidDoc>;
