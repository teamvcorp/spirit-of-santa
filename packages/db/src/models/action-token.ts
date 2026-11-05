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
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

actionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
actionTokenSchema.index({ email: 1, purpose: 1, createdAt: -1 });

export type ActionTokenDoc = InferSchemaType<typeof actionTokenSchema>;
export const ActionToken = (models.ActionToken ??
  model("ActionToken", actionTokenSchema)) as Model<ActionTokenDoc>;
