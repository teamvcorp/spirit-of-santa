/**
 * Deed QR tokens. SERVER-ONLY.
 *
 * The token in a QR link is HMAC(key, deedId). The database stores only SHA-256(token)
 * (Deed.qrTokenHash), so:
 *  - someone who can READ the database still can't produce a working QR link (no key);
 *  - the server can show the same QR again later (it recomputes the token), so a child can show
 *    it to the person they helped any time before it's used or expires.
 * The key is its OWN secret, DEED_QR_KEY (32 random bytes, base64url), NOT the session secret:
 * rotating NEXTAUTH_SECRET must never break outstanding QR codes (review 2026-11-05). Changing
 * DEED_QR_KEY invalidates every unused QR (only do it if it leaked; codes last at most 14 days).
 * Lookup when scanned (slice 4): hash the token from the URL, find the deed by that hash.
 */
import "server-only";
import { createHash, createHmac } from "node:crypto";

let cached: { raw: string; key: Buffer } | null = null;
/** Parsed once per process (and again only if the env value changes, e.g. in tests). */
function key(): Buffer {
  const raw = process.env.DEED_QR_KEY;
  if (!raw) throw new Error("DEED_QR_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const k = Buffer.from(raw, "base64url");
  if (k.length !== 32) throw new Error("DEED_QR_KEY must be 32 bytes (base64url)");
  cached = { raw, key: k };
  return k;
}

/** The secret part of the QR link (43 URL-safe characters). */
export const deedToken = (deedId: string) => createHmac("sha256", key()).update(deedId).digest("base64url");

/** What the database stores / looks up by. */
export const hashDeedToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Looks like one of our tokens? (Cheap check before any DB lookup.) */
export const isDeedToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
