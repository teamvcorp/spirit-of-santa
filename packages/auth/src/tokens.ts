/**
 * Single-use email links (verify email, reset password, invites). SERVER-ONLY.
 * Storage model + rationale: packages/db/src/models/action-token.ts.
 *
 *   const { raw } = await createActionToken("reset_password", { email, userId });
 *   link = `${baseUrl}/reset-password?token=${raw}`;
 *   ...
 *   const token = await consumeActionToken(raw, "reset_password"); // null if bad/used/expired
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ActionToken, trusted, type ActionTokenPurpose } from "@repo/db";

/** How long each kind of link works. */
export const TOKEN_TTL_MS: Record<ActionTokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  invite_owner: 7 * 24 * 60 * 60 * 1000,
  invite_rep: 7 * 24 * 60 * 60 * 1000,
};

/** 32 random bytes, base64url: 43 URL-safe characters, 256 bits of entropy. */
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

/** Ids may be ObjectIds or strings; stored as ObjectIds (Mongoose casts the string form). */
type Id = { toString(): string } | null | undefined;
type TokenTarget = { email: string; userId?: Id; storeId?: Id; createdByUserId?: Id };
const idString = (v: Id) => (v == null ? undefined : String(v));

/**
 * Make a new link token. Older UNUSED tokens of the same purpose for the same email are
 * cancelled first, so only the newest email's link works (fewer live secrets in inboxes).
 */
export async function createActionToken(
  purpose: ActionTokenPurpose,
  target: TokenTarget,
): Promise<{ raw: string; id: string }> {
  const email = target.email.trim().toLowerCase();
  const now = new Date();
  await ActionToken.updateMany({ email, purpose, usedAt: null }, { $set: { usedAt: now } });
  const raw = randomBytes(32).toString("base64url");
  const doc = await ActionToken.create({
    purpose,
    tokenHash: hashToken(raw),
    email,
    userId: idString(target.userId),
    storeId: idString(target.storeId),
    createdByUserId: idString(target.createdByUserId),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]),
  });
  return { raw, id: String(doc._id) };
}

/** Atomically mark a valid token used and return it; null if malformed, used or expired. */
export async function consumeActionToken(raw: unknown, purpose: ActionTokenPurpose) {
  if (typeof raw !== "string" || !RAW_TOKEN_RE.test(raw)) return null;
  const now = new Date();
  return ActionToken.findOneAndUpdate(
    // usedAt: null in the FILTER makes "check unused + mark used" one atomic step, so two
    // simultaneous clicks can't both succeed. trusted(): our own $gt (see sanitizeFilter).
    { tokenHash: hashToken(raw), purpose, usedAt: null, expiresAt: trusted({ $gt: now }) },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  ).lean();
}

/** Look at a token WITHOUT using it (e.g. to show "invite from X" before accepting). */
export async function peekActionToken(raw: unknown, purpose: ActionTokenPurpose) {
  if (typeof raw !== "string" || !RAW_TOKEN_RE.test(raw)) return null;
  return ActionToken.findOne({
    tokenHash: hashToken(raw),
    purpose,
    usedAt: null,
    expiresAt: trusted({ $gt: new Date() }),
  }).lean();
}
