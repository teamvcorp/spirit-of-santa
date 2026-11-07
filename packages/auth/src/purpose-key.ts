/**
 * Per-PURPOSE keys derived from one secret (SERVER-ONLY): the ONE implementation (review
 * 2026-11-06 found three copies). HKDF-SHA256, empty salt, a purpose label ("sos/<thing>/v<n>"),
 * 32 bytes. A key derived for one purpose is useless for any other, so the root secret (e.g. the
 * session-signing NEXTAUTH_SECRET) is never used directly. Byte-identical to the earlier copies:
 * existing PIN-unlock cookies, view counters and recovery codes keep working.
 * Labels in use: sos/parent-pin-unlock/v1, sos/item-view/v1, sos/unsubscribe/v1, sos/mfa-recovery/v1.
 */
import "server-only";
import { hkdfSync } from "node:crypto";

export function deriveKey(secret: string | Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", label, 32));
}

const cache = new Map<string, Buffer>();

/** A purpose key from NEXTAUTH_SECRET (cached per secret + label; throws if the secret is missing). */
export function sessionPurposeKey(label: string): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  const id = `${label}\u0000${secret}`;
  let key = cache.get(id);
  if (!key) {
    key = deriveKey(secret, label);
    cache.set(id, key);
  }
  return key;
}
