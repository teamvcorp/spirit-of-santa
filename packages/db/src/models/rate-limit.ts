/**
 * RateLimit = fixed-window counters for abuse-prone public actions (sign-up, "forgot
 * password", resend verification, invites). One document per key per window, e.g.
 *   key "register:ip:203.0.113.7"  windowStart 2026-11-05T10:00Z  count 3
 *
 * Kept in MongoDB so it works across all serverless instances without a new service.
 * (If traffic grows, swap for Upstash/Vercel Firewall; the helper's API stays the same.)
 * Documents delete themselves after their window ends (TTL on expiresAt).
 * Keys contain hashed emails, never raw ones (see packages/auth/src/rate-limit.ts).
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;

const rateLimitSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 200 },
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, min: 0, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true });
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimitDoc = InferSchemaType<typeof rateLimitSchema>;
export const RateLimit = (models.RateLimit ??
  model("RateLimit", rateLimitSchema)) as Model<RateLimitDoc>;
