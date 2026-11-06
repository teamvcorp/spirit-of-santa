/**
 * Deed QR tokens. SERVER-ONLY.
 *
 * The token in a QR link is HMAC(key, deedId), with the key derived (HKDF) from NEXTAUTH_SECRET
 * under its own label. The database stores only SHA-256(token) (Deed.qrTokenHash), so:
 *  - someone who can READ the database still can't produce a working QR link (no secret);
 *  - the server can show the same QR again later (it recomputes the token), so a child can show
 *    it to the person they helped any time before it's used or expires.
 * Lookup when scanned (slice 4): hash the token from the URL, find the deed by that hash.
 */
import "server-only";
import { createHash, createHmac, hkdfSync } from "node:crypto";

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", "sos/deed-qr/v1", 32));
}

/** The secret part of the QR link (43 URL-safe characters). */
export const deedToken = (deedId: string) => createHmac("sha256", key()).update(deedId).digest("base64url");

/** What the database stores / looks up by. */
export const hashDeedToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Looks like one of our tokens? (Cheap check before any DB lookup.) */
export const isDeedToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
