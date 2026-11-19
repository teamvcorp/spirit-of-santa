/**
 * ActionToken = a single-use secret link sent by email: verify an email address, reset a
 * password, or accept an invite (store owner / store rep).
 *
 * Security (same approach as the deed QR codes):
 *  - The link carries 32 random bytes; we store only their SHA-256 hash (tokenHash). A
 *    database leak therefore can't be turned into working links.
 *  - Single use: consuming sets usedAt atomically (findOneAndUpdate with usedAt: null), so
 *    two clicks racing can't both succeed.
 *  - Short lifetimes (set by the caller): verify 24 h, reset 1 h, invites 7 days.
 *  - Expired/used rows are deleted automatically 30 days after expiry (TTL index), so the
 *    collection doesn't grow forever but recent history stays for support questions.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId } from "./_shared.ts";

export const ACTION_TOKEN_PURPOSES = [
  "verify_email",
  "reset_password",
  "invite_owner",
  "invite_rep",
  /** "Yes, send me news" confirm link (public form + donors, owner 2026-11-12): double opt-in, 7 days. */
  "news_confirm",
  /**
   * Store sign-up, EMAIL FIRST (owner 2026-11-19): the email gets a "Register your store" link; nothing else exists
   * until it is used. Works 14 days, and the row (the address) is DELETED at 14 days (purgeAt).
   */
  "store_signup",
  /**
   * A store's single-use "give Christmas Magic as {store}" link (founding partners slice 3): opens /donate in store
   * mode; used up when the checkout starts. Sent only to the store's CONFIRMED owner. 7 days.
   */
  "store_gift",
] as const;
export type ActionTokenPurpose = (typeof ACTION_TOKEN_PURPOSES)[number];

const actionTokenSchema = new Schema(
  {
    purpose: { type: String, enum: ACTION_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ },
    /** Who it's for. Invites may not have a user yet (created on acceptance). */
    userId: objectId("User", false),
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    storeId: objectId("Store", false),
    createdByUserId: objectId("User", false), // the admin/owner who sent an invite
    /** news_confirm only: where they asked (NewsSubscription source) and the language to answer in. */
    newsSource: { type: String, enum: ["public", "donor", "tip"] },
    locale: { type: String, enum: ["en", "es"] },
    /** news_confirm: version of the opt-in wording shown when they ticked the box (proof, even if it changes later). */
    newsConsentVersion: { type: String, maxlength: 40 },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    /** When set, the row is deleted at this moment (TTL 0). store_signup: 14 days, owner's rule for unused emails. */
    purgeAt: Date,
    /**
     * store_signup: set ONLY when the link really created the account (usedAt alone also means "cancelled by a newer
     * link"), so the page shows "your account is ready" only then (review 2026-11-19).
     */
    completedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

actionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
actionTokenSchema.index({ email: 1, purpose: 1, createdAt: -1 });
// Rows WITH purgeAt are deleted at that time (rows without it never match this index's TTL).
actionTokenSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export type ActionTokenDoc = InferSchemaType<typeof actionTokenSchema>;
export const ActionToken = (models.ActionToken ??
  model("ActionToken", actionTokenSchema)) as Model<ActionTokenDoc>;
