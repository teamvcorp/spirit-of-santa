/**
 * Admin user management (Phase 3 slice 3). SERVER-ONLY. Callers check the admin role first
 * (requireRole) and pass the admin's id as `actorId`.
 *
 * What admins can do (all audited, change + audit row in one transaction):
 *  - suspend (reason required): sign-in blocked, sessionVersion++ (every session ends within
 *    the 5-minute JWT re-check; store pages re-check membership in the DB immediately)
 *  - reinstate, unlock (clear a sign-in lockout), sign out everywhere, reset MFA (admins)
 * Guard rails: never on yourself (suspend / reset own MFA), so at least one admin always works.
 * Not here on purpose: deleting accounts (COPPA deletion flow, Phase 8) and activating
 * unverified accounts (would bypass email verification).
 * Kids are Kid records, not users: they never appear in these lists (COPPA).
 */
import "server-only";
import { AuditLog, connectDb, Store, trusted, User, withTransaction, type AuditAction } from "@repo/db";
import { ROLES, type Role } from "@repo/lib/roles";
import { normalizeObjectId } from "@repo/lib/ids";

export const USER_PAGE_SIZE = 50;
/** Escape a string for use inside a RegExp (search input is never a pattern). */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type UserListFilter = { q?: string; role?: Role; status?: "pending" | "active" | "suspended"; page?: number };

export type UserRow = {
  id: string;
  email: string;
  role: Role;
  status: string;
  createdAt?: Date;
  lastLoginAt?: Date;
  mfa: boolean;
};

/** Newest first. Email search = "starts with" (emails are stored lowercase: index-friendly). */
export async function listUsers(f: UserListFilter): Promise<{ rows: UserRow[]; total: number; page: number; pages: number }> {
  await connectDb();
  const filter: Record<string, unknown> = {};
  const q = f.q?.trim().toLowerCase().slice(0, 254);
  if (q) filter.email = trusted({ $regex: `^${escapeRegex(q)}` });
  if (f.role && (ROLES as readonly string[]).includes(f.role)) filter.role = f.role;
  if (f.status) filter.status = f.status;
  const page = Math.max(1, Math.min(1000, Math.floor(f.page ?? 1)));
  const [docs, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * USER_PAGE_SIZE).limit(USER_PAGE_SIZE).select("email role status createdAt lastLoginAt mfa.enabled").lean(),
    User.countDocuments(filter),
  ]);
  return {
    rows: docs.map((u) => ({
      id: String(u._id),
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt ?? undefined,
      mfa: u.mfa?.enabled === true,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / USER_PAGE_SIZE)),
  };
}

/** One user's details for the admin page, plus the latest audit entries about them. */
export async function getUserDetail(rawId: string) {
  const id = normalizeObjectId(rawId);
  if (!id) return null;
  await connectDb();
  const u = await User.findById(id).select("email name role status locale createdAt lastLoginAt storeId familyId suspendedByAdmin mfa.enabled mfa.enabledAt +lockedUntil").lean();
  if (!u) return null;
  const [store, history, codes] = await Promise.all([
    u.storeId ? Store.findById(u.storeId).select("name status").lean() : null,
    AuditLog.find({ $or: [{ targetType: "user", targetId: u._id }, { actorUserId: u._id }] })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("action targetType actorUserId details createdAt")
      .lean(),
    // Count recovery codes INSIDE the database: their hashes never reach this process
    // (review 2026-11-05). Matched by email (unique) to avoid casting ids in a pipeline.
    u.mfa?.enabled
      ? User.aggregate<{ n: number }>([{ $match: { email: u.email } }, { $project: { _id: 0, n: { $size: { $ifNull: ["$mfa.recoveryCodeHashes", []] } } } }])
      : Promise.resolve([] as { n: number }[]),
  ]);
  return {
    id: String(u._id),
    email: u.email,
    name: u.name ?? undefined,
    role: u.role,
    status: u.status,
    /** false for a suspended rep = removed by their store (not an admin decision). */
    suspendedByAdmin: u.suspendedByAdmin === true,
    locale: u.locale,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? undefined,
    lockedUntil: u.lockedUntil && new Date(u.lockedUntil) > new Date() ? u.lockedUntil : undefined,
    store: store ? { id: String(store._id), name: store.name, status: store.status } : undefined,
    hasFamily: Boolean(u.familyId),
    mfa: u.mfa?.enabled ? { since: u.mfa.enabledAt ?? undefined, recoveryCodesLeft: codes[0]?.n ?? 0 } : undefined,
    history: history.map((h) => ({
      action: h.action,
      byThisUser: String(h.actorUserId) === String(u._id),
      details: h.details as Record<string, unknown> | undefined,
      at: h.createdAt,
    })),
  };
}

export type UserAdminResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "self" | "badStatus" | "notAdmin" | "removedRep" | "notLocked" };

/** Normalised ids (lower-case: see @repo/lib/ids) so "is this me?" can't be fooled by case. */
function ids(actorId: string, id: string) {
  return { actor: normalizeObjectId(actorId), target: normalizeObjectId(id) };
}

/** Change + audit row in ONE transaction. `filter` = the state we expect (compare-and-set). */
async function changeAudited(
  actorId: string,
  target: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  action: AuditAction,
  details: Record<string, unknown>,
): Promise<UserAdminResult> {
  await connectDb();
  return withTransaction(async (session) => {
    const res = await User.updateOne({ _id: target, ...filter }, update, { session });
    if (res.matchedCount !== 1) {
      const exists = await User.exists({ _id: target }).session(session);
      return { ok: false, error: exists ? "badStatus" : "notFound" } as const;
    }
    await AuditLog.create([{ actorUserId: actorId, action, targetType: "user", targetId: target, details }], { session });
    return { ok: true } as const;
  });
}

/**
 * Block sign-in and end every session. Only active accounts; never yourself.
 * `suspendedByAdmin` marks it as an ADMIN decision: a store removing a rep also sets
 * "suspended", and only admin suspensions may be reinstated here (and a store's re-invite
 * can't undo an admin suspension: account-flows acceptRepInvite).
 */
export async function suspendUser(actorId: string, id: string, reason: string): Promise<UserAdminResult> {
  const { actor, target } = ids(actorId, id);
  if (!actor || !target) return { ok: false, error: "notFound" };
  if (actor === target) return { ok: false, error: "self" };
  return changeAudited(actor, target, { status: "active" }, { $set: { status: "suspended", suspendedByAdmin: true }, $inc: { sessionVersion: 1 } }, "user.suspend", { from: "active", to: "suspended", reason });
}

/** Allow sign-in again (sessions stay ended; they sign in fresh). Admin suspensions only. */
export async function reinstateUser(actorId: string, id: string): Promise<UserAdminResult> {
  const { actor, target } = ids(actorId, id);
  if (!actor || !target) return { ok: false, error: "notFound" };
  await connectDb();
  const u = await User.findById(target).select("role status storeId suspendedByAdmin").lean();
  if (!u) return { ok: false, error: "notFound" };
  // A rep removed by their store (or removed meanwhile): reinstating would leave an active rep
  // with no store. The store can re-invite them instead.
  if (u.status === "suspended" && (!u.suspendedByAdmin || (u.role === "store_rep" && !u.storeId))) return { ok: false, error: "removedRep" };
  return changeAudited(actor, target, { status: "suspended", suspendedByAdmin: true }, { $set: { status: "active" }, $unset: { suspendedByAdmin: 1 }, $inc: { sessionVersion: 1 } }, "user.reinstate", { from: "suspended", to: "active" });
}

/** Clear a CURRENT sign-in lockout (5 bad tries, or 10 bad codes). */
export async function unlockUser(actorId: string, id: string): Promise<UserAdminResult> {
  const { actor, target } = ids(actorId, id);
  if (!actor || !target) return { ok: false, error: "notFound" };
  // $unset of mfa.failures (not $set 0): never creates an "mfa" object on non-admin users.
  const r = await changeAudited(actor, target, { lockedUntil: trusted({ $gt: new Date() }) }, { $unset: { lockedUntil: 1, "mfa.failures": 1 }, $set: { failedLoginCount: 0 } }, "user.unlock", {});
  return !r.ok && r.error === "badStatus" ? { ok: false, error: "notLocked" } : r;
}

/** End every session of an ACTIVE user (e.g. a lost laptop). They can sign in again. */
export async function signOutEverywhere(actorId: string, id: string): Promise<UserAdminResult> {
  const { actor, target } = ids(actorId, id);
  if (!actor || !target) return { ok: false, error: "notFound" };
  return changeAudited(actor, target, { status: "active" }, { $inc: { sessionVersion: 1 } }, "user.sign_out_all", {});
}

/** Lost phone: turn MFA off for ANOTHER admin (they set it up again at their next sign-in). */
export async function resetUserMfa(actorId: string, id: string): Promise<UserAdminResult> {
  const { actor, target } = ids(actorId, id);
  if (!actor || !target) return { ok: false, error: "notFound" };
  if (actor === target) return { ok: false, error: "self" };
  // Role + "MFA is on" in the filter: checked in the same atomic write as the reset.
  const r = await changeAudited(actor, target, { role: "admin", "mfa.enabled": true }, { $unset: { mfa: 1 }, $inc: { sessionVersion: 1 } }, "user.mfa_reset", {});
  if (!r.ok && r.error === "badStatus") {
    const u = await User.findById(target).select("role").lean();
    return { ok: false, error: u?.role === "admin" ? "badStatus" : "notAdmin" };
  }
  return r;
}
