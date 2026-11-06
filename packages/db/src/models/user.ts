/**
 * User = anyone who signs in: parents, store owners/reps, admins.
 * Children are NOT users (COPPA data minimisation); they're Kid records under a Family.
 * Community members tip without an account.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { ROLES } from "@repo/lib/roles";
import { LOCALES, hideFields, objectId } from "./_shared.ts";

/** pending = awaiting email verification / approval; suspended = blocked by admin. */
export const USER_STATUSES = ["pending", "active", "suspended"] as const;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true, // makes the unique index case-insensitive in practice
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    /** argon2id hash (packages/auth). Never selected unless explicitly requested. */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "pending",
      required: true,
    },
    familyId: objectId("Family", false), // set for parents
    storeId: objectId("Store", false), // set for store owners/reps
    locale: { type: String, enum: LOCALES, default: "en" },

    // Brute-force protection (packages/auth increments these on failed logins).
    failedLoginCount: { type: Number, default: 0, min: 0, select: false },
    lockedUntil: { type: Date, select: false },
    lastLoginAt: Date,

    /**
     * Bump to invalidate every existing session for this user (password change,
     * suspension, "sign out everywhere"). JWTs carry the version they were issued with.
     */
    sessionVersion: { type: Number, default: 0, min: 0 },

    /**
     * Two-factor sign-in (authenticator app / TOTP). Required for admins (Phase 3 slice 1).
     * Secrets are AES-256-GCM encrypted with MFA_ENCRYPTION_KEY (packages/auth/src/mfa.ts),
     * recovery codes are stored only as keyed hashes, and none of it is ever selected by default.
     */
    mfa: {
      enabled: { type: Boolean, default: false },
      enabledAt: Date,
      secretEnc: { type: String, select: false, maxlength: 512 },
      /** Set while the admin is scanning the QR code; replaced by secretEnc once confirmed. */
      pendingSecretEnc: { type: String, select: false, maxlength: 512 },
      pendingAt: { type: Date, select: false },
      /** Last accepted 30 s step: the same code can't be used twice (replay protection). */
      lastStep: { type: Number, select: false },
      recoveryCodeHashes: { type: [String], select: false, default: undefined },
      /** Wrong codes in a row (after a CORRECT password). 10 → 24 h lock (mfa.ts). */
      failures: { type: Number, select: false, min: 0 },
    },

    /** FCM device tokens for push (Phase 7). */
    fcmTokens: { type: [String], default: [], select: false },
  },
  {
    timestamps: true,
    toJSON: hideFields(
      "passwordHash",
      "failedLoginCount",
      "lockedUntil",
      "fcmTokens",
      "mfa",
    ),
  },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = (models.User ??
  model("User", userSchema)) as Model<UserDoc>;
