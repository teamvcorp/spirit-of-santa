/**
 * Admin two-factor sign-in (authenticator app). SERVER-ONLY.
 * Decisions (user, 2026-11-05): TOTP authenticator app + 10 one-time recovery codes, no
 * emailed codes. Required for every admin; other roles don't use it yet.
 *
 * Flow:
 *  1. Admin signs in with a password but has no MFA yet → restricted session (`mfaSetup`)
 *     that can only open /mfa/setup (guards.ts).
 *  2. beginMfaSetup(): new random secret, stored ENCRYPTED as "pending", shown as a QR code.
 *  3. confirmMfaSetup(code): code checks out → MFA on, 10 recovery codes shown once,
 *     sessionVersion++ (every session ends; sign in again WITH a code).
 *  4. Every later sign-in: verifySecondFactor(code) = a fresh TOTP code (never the same 30 s
 *     step twice) or an unused recovery code (each works once).
 *  5. Lost phone and codes: `npm run admin:create` again → resetMfa() → back to step 1.
 *
 * Storage (User.mfa, never selected by default):
 *  - Secrets: AES-256-GCM with MFA_ENCRYPTION_KEY (32 random bytes, base64url), bound to the
 *    user id as "additional data", so a secret copied onto another user record won't decrypt.
 *    A separate key from NEXTAUTH_SECRET: rotating sessions never locks admins out, and a leaked
 *    session key alone can't read MFA secrets.
 *  - Recovery codes: HMAC-SHA256 under a key derived (HKDF) from MFA_ENCRYPTION_KEY.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AuditLog, connectDb, trusted, User, withTransaction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { hitRateLimit } from "./rate-limit.ts";
import {
  formatManualKey,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp.ts";

/** Name shown in the authenticator app next to the admin's email. */
export const MFA_ISSUER = "Spirit O Santa Admin";
/** A pending (scanned-but-unconfirmed) secret can be confirmed for this long... */
const PENDING_MINUTES = 15;
/** ...and a reload only shows the SAME QR code while at least 5 minutes are left (review 2026-11-05). */
const REUSE_MINUTES = 10;
/**
 * Wrong codes in a row after a CORRECT password → 24 h lock + audit. The normal 5-tries/15-min
 * lockout alone would let someone with a stolen password guess ~480 codes a day forever.
 */
export const MAX_MFA_FAILURES = 10;
const MFA_LOCK_HOURS = 24;
const ENC_VERSION = "v1";

// ── Keys ──────────────────────────────────────────────────────────────────────────────
function encryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error("MFA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (base64url)");
  return key;
}
const recoveryKey = () => Buffer.from(hkdfSync("sha256", encryptionKey(), "", "sos/mfa-recovery/v1", 32));

/** "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(secret: Buffer, userId: string): string {
  const iv = randomBytes(12); // 96-bit nonce, fresh every time (GCM requirement)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [ENC_VERSION, iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string, userId: string): Buffer {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== ENC_VERSION || !iv || !tag || !ct) throw new Error("unknown MFA secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url")); // tampering → final() throws
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
}

/** decryptSecret, or null if it can't be read (key changed, corrupted value). */
function tryDecrypt(stored: string, userId: string): Buffer | null {
  try {
    return decryptSecret(stored, userId);
  } catch {
    return null;
  }
}

export const hashRecoveryCode = (normalized: string) => createHmac("sha256", recoveryKey()).update(normalized).digest("hex");

async function audit(userId: string, action: "user.mfa_enable" | "user.mfa_reset" | "user.mfa_recovery_used" | "user.mfa_locked", details: Record<string, unknown> = {}) {
  await AuditLog.create({ actorUserId: userId, action, targetType: "user", targetId: userId, details });
}

// ── Setup ─────────────────────────────────────────────────────────────────────────────
export type MfaSetupView =
  | { status: "enabled" }
  | { status: "pending"; qrDataUrl: string; manualKey: string; issuer: string; account: string };

/**
 * What /mfa/setup shows. Creates (or reuses, for 15 min) a pending secret for an active admin
 * whose MFA is off. Safe to call on every page load: a reload shows the SAME QR code.
 */
export async function beginMfaSetup(userId: string): Promise<MfaSetupView | null> {
  await connectDb();
  const user = await User.findOne({ _id: userId, role: "admin", status: "active" })
    .select("email mfa.enabled +mfa.pendingSecretEnc +mfa.pendingAt")
    .lean();
  if (!user) return null;
  if (user.mfa?.enabled) return { status: "enabled" };
  const oldEnc = user.mfa?.pendingSecretEnc;
  const reusable = (enc: string | null | undefined, at: Date | null | undefined) =>
    enc && at && Date.now() - new Date(at).getTime() < REUSE_MINUTES * 60_000 ? tryDecrypt(enc, userId) : null;
  let secret = reusable(oldEnc, user.mfa?.pendingAt);
  if (!secret) {
    const candidate = generateTotpSecret();
    // Compare-and-set on the OLD pending value: two tabs rendering at once can't each show a
    // different QR code with only the last one confirmable (review 2026-11-05).
    const res = await User.updateOne(
      { _id: userId, "mfa.enabled": trusted({ $ne: true }), "mfa.pendingSecretEnc": oldEnc ? oldEnc : trusted({ $exists: false }) },
      { $set: { "mfa.pendingSecretEnc": encryptSecret(candidate, userId), "mfa.pendingAt": new Date() } },
    );
    if (res.modifiedCount === 1) secret = candidate;
    else {
      // Another render won: show ITS secret.
      const now = await User.findById(userId).select("+mfa.pendingSecretEnc +mfa.pendingAt").lean();
      secret = reusable(now?.mfa?.pendingSecretEnc, now?.mfa?.pendingAt);
      if (!secret) return null;
    }
  }
  const uri = otpauthUri(secret, user.email, MFA_ISSUER);
  // An <img> data URL (not inline SVG markup) so no generated HTML is ever injected into the page.
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return { status: "pending", qrDataUrl, manualKey: formatManualKey(secret), issuer: MFA_ISSUER, account: user.email };
}

export type ConfirmResult = { ok: true; recoveryCodes: string[] } | { ok: false; error: "invalidCode" | "expired" | "rateLimited" | "notFound" };

/** Check the first code from the app; on success turn MFA on and return the recovery codes (shown once). */
export async function confirmMfaSetup(userId: string, code: string): Promise<ConfirmResult> {
  await connectDb();
  // 10 tries per 15 min: a 6-digit code mustn't be guessable here either.
  if (!(await hitRateLimit(`mfa-setup:${userId}`, 10, 900))) return { ok: false, error: "rateLimited" };
  const user = await User.findOne({ _id: userId, role: "admin", status: "active" })
    .select("email locale mfa.enabled +mfa.pendingSecretEnc +mfa.pendingAt")
    .lean();
  if (!user || user.mfa?.enabled) return { ok: false, error: "notFound" };
  const pendingAt = user.mfa?.pendingAt ? new Date(user.mfa.pendingAt).getTime() : 0;
  if (!user.mfa?.pendingSecretEnc || Date.now() - pendingAt > PENDING_MINUTES * 60_000) return { ok: false, error: "expired" };
  // Unreadable (e.g. MFA_ENCRYPTION_KEY changed while the page was open): "reload for a new QR".
  const secret = tryDecrypt(user.mfa.pendingSecretEnc, userId);
  if (!secret) return { ok: false, error: "expired" };
  const step = verifyTotp(secret, code);
  if (step == null) return { ok: false, error: "invalidCode" };
  const recoveryCodes = generateRecoveryCodes();
  const res = await User.updateOne(
    // Still off and still the same pending secret: two tabs can't both "win".
    { _id: userId, "mfa.enabled": trusted({ $ne: true }), "mfa.pendingSecretEnc": user.mfa.pendingSecretEnc },
    {
      $set: {
        "mfa.enabled": true,
        "mfa.enabledAt": new Date(),
        "mfa.secretEnc": encryptSecret(secret, userId), // fresh nonce
        "mfa.lastStep": step, // the confirming code can't then be reused to sign in
        "mfa.recoveryCodeHashes": recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)),
      },
      $unset: { "mfa.pendingSecretEnc": 1, "mfa.pendingAt": 1 },
      $inc: { sessionVersion: 1 }, // end every session: sign in again with a code
    },
  );
  if (res.modifiedCount !== 1) return { ok: false, error: "expired" };
  await audit(userId, "user.mfa_enable");
  // Security alert to the account's own address. Enrolment is "first come, first served": if
  // someone else used a leaked password to enrol their phone, the real admin hears about it now
  // (review 2026-11-05). A failed email must not undo the enrolment, so it's only logged.
  try {
    const base = process.env.NEXTAUTH_URL;
    if (base) await sendEmail({ to: user.email, template: "mfaEnabled", values: { link: new URL("/signin", base).toString() }, locale: user.locale });
  } catch (err) {
    console.error("[mfa] alert email failed:", err instanceof Error ? err.name : "unknown");
  }
  return { ok: true, recoveryCodes };
}

// ── Sign-in ───────────────────────────────────────────────────────────────────────────
/**
 * Second factor at sign-in: a TOTP code (6 digits) or a recovery code. Returns true once per
 * code: a TOTP step is recorded atomically (no replay), a recovery code is removed atomically.
 * Call ONLY after the password was verified.
 */
/**
 * "ok"     = accepted (and now used up).
 * "replay" = a CORRECT code that was already used (double-click, resubmit within 30 s): refused,
 *            but not a strike against the real admin (review 2026-11-05).
 * "wrong"  = not a valid code: the caller counts a strike (recordMfaFailure + login lockout).
 * Throws if the stored secret can't be decrypted (a key problem, not the person's fault: the
 * sign-in fails without a strike, with a clear server log).
 */
export type SecondFactorResult = "ok" | "replay" | "wrong";

export async function verifySecondFactor(userId: string, input: string): Promise<SecondFactorResult> {
  const code = input.trim();
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const user = await User.findById(userId).select("mfa.enabled +mfa.secretEnc +mfa.lastStep").lean();
    if (!user?.mfa?.enabled || !user.mfa.secretEnc) return "wrong";
    const secret = tryDecrypt(user.mfa.secretEnc, userId);
    if (!secret) {
      console.error("[mfa] stored secret could not be decrypted: check MFA_ENCRYPTION_KEY (same value as when MFA was set up?)");
      throw new Error("MFA secret unreadable");
    }
    const step = verifyTotp(secret, code);
    if (step == null) return "wrong";
    // Atomic "only if newer than the last accepted step": the same code twice, or two parallel
    // sign-ins with one code, can only succeed once.
    const res = await User.updateOne(
      { _id: userId, "mfa.enabled": true, $or: [{ "mfa.lastStep": trusted({ $lt: step }) }, { "mfa.lastStep": trusted({ $exists: false }) }] },
      { $set: { "mfa.lastStep": step, "mfa.failures": 0 } },
    );
    return res.modifiedCount === 1 ? "ok" : "replay";
  }
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return "wrong";
  const hash = hashRecoveryCode(normalized);
  const res = await User.updateOne(
    { _id: userId, "mfa.enabled": true, "mfa.recoveryCodeHashes": hash },
    { $pull: { "mfa.recoveryCodeHashes": hash }, $set: { "mfa.failures": 0 } },
  );
  if (res.modifiedCount !== 1) return "wrong";
  const left = await User.findById(userId).select("+mfa.recoveryCodeHashes").lean();
  await audit(userId, "user.mfa_recovery_used", { remaining: left?.mfa?.recoveryCodeHashes?.length ?? 0 });
  return "ok";
}

/**
 * A wrong code after a correct password. MAX_MFA_FAILURES in a row → locked for 24 h and
 * audited (whoever is guessing already HAS the password). Atomic counter: parallel guesses
 * can't slip past the limit.
 */
export async function recordMfaFailure(userId: string): Promise<void> {
  const after = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { "mfa.failures": 1 } },
    { returnDocument: "after" },
  )
    .select("+mfa.failures")
    .lean();
  if ((after?.mfa?.failures ?? 0) >= MAX_MFA_FAILURES) {
    await User.updateOne(
      { _id: userId },
      { $set: { lockedUntil: new Date(Date.now() + MFA_LOCK_HOURS * 3_600_000), "mfa.failures": 0, failedLoginCount: 0 } },
    );
    await audit(userId, "user.mfa_locked", { hours: MFA_LOCK_HOURS });
  }
}

/** Turn MFA off (lost phone): the admin sets it up again at the next sign-in. Ends all sessions. */
export async function resetMfa(userId: string, actorUserId = userId): Promise<void> {
  await connectDb();
  // Change + audit together: MFA is never removed without a record.
  await withTransaction(async (session) => {
    await User.updateOne({ _id: userId }, { $unset: { mfa: 1 }, $inc: { sessionVersion: 1 } }, { session });
    await AuditLog.create([{ actorUserId, action: "user.mfa_reset", targetType: "user", targetId: userId, details: {} }], { session });
  });
}
