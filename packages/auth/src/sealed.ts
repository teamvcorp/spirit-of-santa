/**
 * Encryption at rest for small secrets and personal data (SERVER-ONLY). One implementation for
 * every use, each with its OWN key so a leak of one key exposes one kind of data only:
 *   MFA_ENCRYPTION_KEY      admin authenticator secrets (admin app)
 *   ADDRESS_ENCRYPTION_KEY  families' delivery addresses (family + admin apps; Phase 6 slice 4b)
 *
 * AES-256-GCM (authenticated: any tampering makes decryption fail), a fresh random 96-bit nonce
 * per value, and "associated data" (AAD) binding each value to its owner (a user or family id):
 * a ciphertext copied onto another record won't decrypt there.
 * Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url parts). Keys: 32 random bytes, base64url
 * (generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))").
 */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SealKeyName = "MFA_ENCRYPTION_KEY" | "ADDRESS_ENCRYPTION_KEY";
const VERSION = "v1";

/** The 32-byte key from the environment (throws with a clear message if missing or malformed). */
export function sealKey(name: SealKeyName): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);
  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes (base64url)`);
  return key;
}

export function seal(plain: Buffer, aad: string, keyName: SealKeyName): string {
  const iv = randomBytes(12); // fresh every time (GCM requirement: never reuse a nonce with a key)
  const cipher = createCipheriv("aes-256-gcm", sealKey(keyName), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Throws if the value is malformed, tampered with, bound to another owner, or the key changed. */
export function unseal(stored: string, aad: string, keyName: SealKeyName): Buffer {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== VERSION || !iv || !tag || !ct) throw new Error("unknown sealed value format");
  const decipher = createDecipheriv("aes-256-gcm", sealKey(keyName), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
}

/** JSON helpers (e.g. an address object). unsealJson returns null when it can't be read. */
export const sealJson = (value: unknown, aad: string, keyName: SealKeyName) => seal(Buffer.from(JSON.stringify(value)), aad, keyName);
export function unsealJson<T>(stored: string, aad: string, keyName: SealKeyName): T | null {
  sealKey(keyName); // outside the try: a MISSING or malformed key is a configuration error, never "unreadable"
  try {
    return JSON.parse(unseal(stored, aad, keyName).toString("utf8")) as T;
  } catch {
    return null;
  }
}
