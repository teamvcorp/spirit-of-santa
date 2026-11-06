/**
 * Fixed-window rate limiting for public actions. SERVER-ONLY.
 *
 *   if (!(await hitRateLimit(`register:ip:${ip}`, 5, 3600))) return tooManyRequests;
 *
 * Fixed windows are simple and good enough here (worst case ~2× the limit across a window
 * edge). Storage: packages/db/src/models/rate-limit.ts. Emails in keys are HASHED so the
 * counters collection holds no personal data.
 */
import "server-only";
import { createHash } from "node:crypto";
import { connectDb, RateLimit } from "@repo/db";

/** Count one hit for `key`; returns true if still within `limit` for this window. */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  // Often the first DB call of a request: make sure the (cached) connection is open.
  await connectDb();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const bump = () =>
    RateLimit.findOneAndUpdate(
      { key: key.slice(0, 200), windowStart },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart.getTime() + windowMs) } },
      { upsert: true, returnDocument: "after" },
    ).lean();
  let doc;
  try {
    doc = await bump();
  } catch (err) {
    // Two first-hits racing to create the window's document: one wins (11000), retry once.
    if ((err as { code?: number }).code !== 11000) throw err;
    doc = await bump();
  }
  return (doc?.count ?? Infinity) <= limit;
}

/** Stable, non-reversible key part for an email address. */
export const emailKey = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

/**
 * Best-effort client IP from request headers. On Vercel these headers are set by the
 * platform (a client can't spoof them past Vercel's edge). Locally it's usually ::1.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || "unknown").slice(0, 64);
}

/**
 * Rate-limit key for an IP. IPv4 → the address. IPv6 → its /64 network: one household or
 * server usually gets a whole /64 (2^64 addresses), so keying on the full address would let
 * one attacker rotate addresses forever (review finding 2026-11-05).
 * IPv4-mapped IPv6 ("::ffff:203.0.113.7") is treated as the IPv4 address.
 */
export function ipKey(ip: string): string {
  const s = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1]!;
  if (!s.includes(":")) return s;
  const [head = "", tail = ""] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = s.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length < 4) return s;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "") || "0").join(":")}::/64`;
}