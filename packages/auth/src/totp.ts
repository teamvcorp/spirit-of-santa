/**
 * TOTP (RFC 6238) + one-time recovery codes for admin MFA. SERVER-ONLY. No dependencies:
 * just Node's crypto, so the security-critical part is small enough to read in full.
 *
 * How an authenticator app works (Google/Microsoft Authenticator, 1Password, ...):
 *  1. We share a random SECRET once (QR code). Both sides keep it.
 *  2. Every 30 s both compute HMAC-SHA1(secret, "number of 30 s steps since 1970") and turn it
 *     into 6 digits (RFC 4226 "dynamic truncation"). Same secret + same time = same code.
 *  3. We accept the current step ±1 (clock drift), and the caller stores the step it accepted
 *     so the SAME code can't be replayed (mfa.ts).
 * SHA-1 here is fine: HMAC-SHA1 is not affected by SHA-1 collision attacks, and it's the
 * only algorithm every authenticator app supports.
 *
 * Tests: packages/auth/test/totp.test.ts (official RFC 6238 test vectors).
 */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept codes from 1 step before/after now (±30 s of clock drift). */
const DRIFT_STEPS = 1;
/** RFC 4648 base32 alphabet: what authenticator apps expect for the secret. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret: 20 bytes (160 bits, the RFC's recommended size for SHA-1). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** The 30-second step number for a time. */
export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step (RFC 4226 HOTP with the step as the counter). */
export function totpCode(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f; // dynamic truncation
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Check a 6-digit code against now ±1 step. Returns the MATCHING STEP (so the caller can
 * refuse that step next time: replay protection) or null. Constant-time comparison.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep(nowMs);
  let match: number | null = null;
  // Check every candidate (no early exit) so timing doesn't reveal which step matched.
  for (let s = now - DRIFT_STEPS; s <= now + DRIFT_STEPS; s++) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(c))) match = s;
  }
  return match;
}

/** otpauth:// link that authenticator apps read from the QR code. */
export function otpauthUri(secret: Buffer, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The secret as typed by hand: groups of 4, e.g. "JBSW Y3DP EHPK 3PXP". */
export function formatManualKey(secret: Buffer): string {
  return base32Encode(secret).replace(/(.{4})/g, "$1 ").trim();
}

// ── Recovery codes ─────────────────────────────────────────────────────────────────────
export const RECOVERY_CODE_COUNT = 10;

/** 10 random codes like "k7mq2-xw4pd" (10 base32 chars = 50 bits each). Shown ONCE. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Normalise what a person typed: case, spaces and dashes don't matter. null if not a code. */
export function normalizeRecoveryCode(input: string): string | null {
  const c = input.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-z2-7]{10}$/.test(c) ? c : null;
}
