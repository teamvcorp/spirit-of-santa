/**
 * Signed "parent dashboard unlocked" token. Pure functions (no Next imports) so they can be
 * unit-tested with plain Node. Used by parent-pin.ts.
 *
 * Format: <familyId>.<userId>.<expiresAtMs>.<HMAC-SHA256 base64url>
 */
import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const PIN_UNLOCK_SECONDS = 15 * 60;

export interface UnlockClaims {
  familyId: string;
  userId: string;
}

/** Per-purpose key derived from NEXTAUTH_SECRET (HKDF), so this HMAC key is never the session key. */
function unlockKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "", "sos/parent-pin-unlock/v1", 32),
  );
}

const mac = (data: string, secret: string) =>
  createHmac("sha256", unlockKey(secret)).update(data).digest("base64url");

export function signUnlockToken(
  c: UnlockClaims,
  secret: string,
  now = Date.now(),
): string {
  const data = `${c.familyId}.${c.userId}.${now + PIN_UNLOCK_SECONDS * 1000}`;
  return `${data}.${mac(data, secret)}`;
}

export function verifyUnlockToken(
  token: string | undefined,
  expected: UnlockClaims,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [familyId, userId, exp, sig] = parts as [
    string,
    string,
    string,
    string,
  ];
  const good = Buffer.from(mac(`${familyId}.${userId}.${exp}`, secret));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given))
    return false;
  return (
    familyId === expected.familyId &&
    userId === expected.userId &&
    Number(exp) > now
  );
}
