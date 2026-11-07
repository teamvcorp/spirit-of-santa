/**
 * Race-proof "N tries, then locked for a while" (Phase 8 security audit, 2026-11-06). SERVER-ONLY.
 * Used by sign-in (User.failedLoginCount / lockedUntil) and the parent PIN (Family.pinFailedCount /
 * pinLockedUntil).
 *
 * Teaching note — why "reserve first": the old code did  check lock → verify (slow: argon2) → count the
 * failure. Every request already in flight had passed the lock check, so 500 PARALLEL guesses were all
 * verified, not 5. Now each try first TAKES a slot in one atomic database update that only succeeds while
 * the account is unlocked and has slots left; only then do we verify. At most `max` tries can ever be
 * in flight or failed per lock window, no matter how many requests arrive at once.
 *
 *   if (!(await reserveAttempt(User, { _id }, LOGIN))) → locked
 *   wrong secret      → failAttempt  (the slot stays used = a strike; locks at `max`)
 *   right secret      → caller resets the count to 0 (its normal success update, filtered by unlocked())
 *   no-strike outcome → releaseAttempt (gives the slot back)
 */
import "server-only";
import type { Model } from "mongoose";
import { trusted } from "@repo/db";

export type AttemptRule = {
  /** Field counting strikes (+ tries in flight). */
  count: string;
  /** Field holding the lock end time. */
  lock: string;
  /** Strikes before locking. */
  max: number;
  /** How long a lock lasts. */
  lockMs: number;
};

/**
 * Parent PIN lockout: 5 wrong PINs → 15 min. Lives here (not in parent-pin.ts, which needs Next) so tests can
 * import the real rule.
 */
export const PIN_ATTEMPTS: AttemptRule = { count: "pinFailedCount", lock: "pinLockedUntil", max: 5, lockMs: 15 * 60_000 };

// `match` holds server-side ids, never raw user input. Each OPERATOR object is wrapped in trusted() on its own:
// sanitizeFilter checks every nested object, so wrapping only the outer filter is not enough (caught by
// scripts/e2e/auth-race.ts: it would have refused every sign-in).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
// "Not locked" = no lock time, or one that has passed. $not also matches a missing field, so no $or is needed.
export const unlocked = (r: AttemptRule, now = new Date()) => ({ [r.lock]: trusted({ $not: { $gt: now } }) });
// Locks only ever get LONGER ($max): a 15-min lock written late must never shorten a longer one (e.g. the
// 24 h lock after wrong authenticator codes) set meanwhile by another request.
const lockFor = (r: AttemptRule, from: number) => ({ $max: { [r.lock]: new Date(from + r.lockMs) }, $set: { [r.count]: 0 } });

/** Take one try. false = locked (or out of tries): refuse WITHOUT verifying anything. */
export async function reserveAttempt(model: AnyModel, match: Record<string, unknown>, r: AttemptRule): Promise<boolean> {
  const now = new Date();
  const taken = await model
    .findOneAndUpdate(
      { ...match, ...unlocked(r, now), [r.count]: trusted({ $not: { $gte: r.max } }) },
      { $inc: { [r.count]: 1 } },
      { projection: { _id: 1 } },
    )
    .lean();
  if (taken) return true;
  // All slots used but no lock yet: tries still in flight, or a crash between reserve and fail. Lock now
  // (count back to 0) so the account can never stay stuck at "full" forever.
  await model.updateOne({ ...match, [r.count]: trusted({ $gte: r.max }), ...unlocked(r, now) }, lockFor(r, now.getTime()));
  return false;
}

/** The try failed: its slot stays used. Locks (and resets the count) once `max` strikes are reached. */
export async function failAttempt(model: AnyModel, match: Record<string, unknown>, r: AttemptRule): Promise<boolean> {
  const res = await model.updateOne({ ...match, [r.count]: trusted({ $gte: r.max }) }, lockFor(r, Date.now()));
  return res.modifiedCount === 1; // true = this failure locked the account
}

/**
 * Not a strike (e.g. right password but account not active, or a blank second-factor code), or the check
 * crashed: give the slot back. Known, accepted edge (review 2026-11-06): if a lock reset the count while this
 * try was in flight, the release can cancel ONE later strike. Worth at most one extra guess in a rare
 * interleaving; closing it would need a record per try.
 */
export async function releaseAttempt(model: AnyModel, match: Record<string, unknown>, r: AttemptRule): Promise<void> {
  await model.updateOne({ ...match, [r.count]: trusted({ $gt: 0 }) }, { $inc: { [r.count]: -1 } });
}
