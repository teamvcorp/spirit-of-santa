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
import { resetMfa } from "./mfa.ts";

export const USER_PAGE_SIZE = 50;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
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
export async function getUserDetail(id: string) {
  if (!OBJECT_ID.test(id)) return null;
  await connectDb();
  const u = await User.findById(id).select("email name role status locale createdAt lastLoginAt storeId familyId mfa.enabled mfa.enabledAt +mfa.recoveryCodeHashes +lockedUntil").lean();
  if (!u) return null;
  const [store, history] = await Promise.all([
    u.storeId ? Store.findById(u.storeId).select("name status").lean() : null,
    AuditLog.find({ $or: [{ targetType: "user", targetId: u._id }, { actorUserId: u._id }] })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("action targetType actorUserId details createdAt")
      .lean(),
  ]);
  return {
    id: String(u._id),
    email: u.email,
    name: u.name ?? undefined,
    role: u.role,
    status: u.status,
    locale: u.locale,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? undefined,
    lockedUntil: u.lockedUntil && new Date(u.lockedUntil) > new Date() ? u.lockedUntil : undefined,
    store: store ? { id: String(store._id), name: store.name, status: store.status } : undefined,
    hasFamily: Boolean(u.familyId),
    mfa: u.mfa?.enabled ? { since: u.mfa.enabledAt ?? undefined, recoveryCodesLeft: u.mfa.recoveryCodeHashes?.length ?? 0 } : undefined,
    history: history.map((h) => ({
      action: h.action,
      byThisUser: String(h.actorUserId) === String(u._id),
      details: h.details as Record<string, unknown> | undefined,
      at: h.createdAt,
    })),
  };
}

export type UserAdminResult = { ok: true } | { ok: false; error: "notFound" | "self" | "badStatus" | "notAdmin" };

/** Status change + audit in one transaction; `from` in the filter so a stale page can't overwrite. */
type Changeable = "active" | "suspended";
async function changeStatus(actorId: string, id: string, from: Changeable, to: Changeable, action: AuditAction, details: Record<string, unknown>): Promise<UserAdminResult> {
  if (!OBJECT_ID.test(id)) return { ok: false, error: "notFound" };
  if (id === actorId) return { ok: false, error: "self" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await User.updateOne({ _id: id, status: from }, { $set: { status: to }, $inc: { sessionVersion: 1 } }, { session });
    if (res.matchedCount !== 1) {
      const exists = await User.exists({ _id: id }).session(session);
      return { ok: false, error: exists ? "badStatus" : "notFound" } as const;
    }
    await AuditLog.create([{ actorUserId: actorId, action, targetType: "user", targetId: id, details: { from, to, ...details } }], { session });
    return { ok: true } as const;
  });
}

/** Block sign-in and end every session. Only active accounts; never yourself. */
export const suspendUser = (actorId: string, id: string, reason: string) => changeStatus(actorId, id, "active", "suspended", "user.suspend", { reason });

/** Allow sign-in again (sessions stay ended; they sign in fresh). */
export const reinstateUser = (actorId: string, id: string) => changeStatus(actorId, id, "suspended", "active", "user.reinstate", {});

/** Clear a sign-in lockout (5 bad tries, or 10 bad codes). */
export async function unlockUser(actorId: string, id: string): Promise<UserAdminResult> {
  if (!OBJECT_ID.test(id)) return { ok: false, error: "notFound" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await User.updateOne({ _id: id }, { $unset: { lockedUntil: 1 }, $set: { failedLoginCount: 0, "mfa.failures": 0 } }, { session });
    if (res.matchedCount !== 1) return { ok: false, error: "notFound" } as const;
    await AuditLog.create([{ actorUserId: actorId, action: "user.unlock", targetType: "user", targetId: id, details: {} }], { session });
    return { ok: true } as const;
  });
}

/** End every session of this user (e.g. a lost laptop). They can sign in again. */
export async function signOutEverywhere(actorId: string, id: string): Promise<UserAdminResult> {
  if (!OBJECT_ID.test(id)) return { ok: false, error: "notFound" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await User.updateOne({ _id: id }, { $inc: { sessionVersion: 1 } }, { session });
    if (res.matchedCount !== 1) return { ok: false, error: "notFound" } as const;
    await AuditLog.create([{ actorUserId: actorId, action: "user.sign_out_all", targetType: "user", targetId: id, details: {} }], { session });
    return { ok: true } as const;
  });
}

/** Lost phone: turn MFA off for ANOTHER admin; they set it up again at their next sign-in. */
export async function resetUserMfa(actorId: string, id: string): Promise<UserAdminResult> {
  if (!OBJECT_ID.test(id)) return { ok: false, error: "notFound" };
  if (id === actorId) return { ok: false, error: "self" };
  await connectDb();
  const u = await User.findById(id).select("role").lean();
  if (!u) return { ok: false, error: "notFound" };
  if (u.role !== "admin") return { ok: false, error: "notAdmin" };
  await resetMfa(id, actorId);
  return { ok: true };
}
