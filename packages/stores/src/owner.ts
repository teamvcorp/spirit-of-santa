/**
 * Store owner / rep actions (store app dashboard). SERVER-ONLY.
 *
 * Authorization model (re-checked on EVERY call, from the database, not just the session):
 *  - The caller passes the signed-in user from requireRole(authOptions, "store_owner" | "store_rep").
 *  - ownedStore(): the store must have ownerUserId === caller. memberStore(): owner OR listed rep.
 *    The session's storeId alone is never trusted: a removed rep's token can say storeId for
 *    up to 5 minutes (JWT re-check interval), but repUserIds in the DB is checked immediately.
 *  - Editing is allowed while the store is pending or approved. Rejected/suspended stores
 *    are read-only (the UI says why).
 * Every change writes an AuditLog row (same transaction where it matters).
 */
import "server-only";
import { ActionToken, AuditLog, connectDb, Store, trusted, User, withTransaction, type AuditAction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { cancelOtherTokens, createActionToken, voidToken } from "@repo/auth/tokens";
import { emailKey, hitRateLimit } from "@repo/auth/rate-limit";
import type { StoreDetailsInput } from "@repo/auth/schemas";
import { deletePublicImage, ImageUploadError, isOwnedImagePath, uploadPublicImage, type ImageUploadErrorCode } from "@repo/storage/images";

export type StoreActor = { id: string; role: string; storeId?: string };
export type OwnerResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "readOnly" | "notApproved" | "tooManyPhotos" | "emailInUse" | "rateLimited" | "emailFailed" | ImageUploadErrorCode };

const EDITABLE = ["pending", "approved"] as const;
export const MAX_STORE_PHOTOS = 10;

type StoreLite = { _id: { toString(): string }; name: string; status: string; ownerUserId?: { toString(): string } | null };

/** The caller's store if they OWN it (fresh from the DB), else null. */
async function ownedStore(actor: StoreActor): Promise<StoreLite | null> {
  if (actor.role !== "store_owner" || !actor.storeId) return null;
  await connectDb();
  return Store.findOne({ _id: actor.storeId, ownerUserId: actor.id }).select("name status ownerUserId").lean<StoreLite>();
}

/** The caller's store if they're its owner or a CURRENT rep, else null. */
export async function memberStore(actor: StoreActor) {
  if (!actor.storeId || (actor.role !== "store_owner" && actor.role !== "store_rep")) return null;
  await connectDb();
  const membership = actor.role === "store_owner" ? { ownerUserId: actor.id } : { repUserIds: actor.id };
  return Store.findOne({ _id: actor.storeId, ...membership }).lean();
}

const isEditable = (status: string) => (EDITABLE as readonly string[]).includes(status);

async function audit(actorId: string, action: AuditAction, targetType: "store" | "user", targetId: string, details: Record<string, unknown> = {}) {
  await AuditLog.create({ actorUserId: actorId, action, targetType, targetId, details });
}

// ── Profile ──────────────────────────────────────────────────────────────────────────
export async function updateStoreProfile(actor: StoreActor, input: StoreDetailsInput): Promise<OwnerResult> {
  const store = await ownedStore(actor);
  if (!store) return { ok: false, error: "notFound" };
  if (!isEditable(store.status)) return { ok: false, error: "readOnly" };
  const res = await Store.updateOne(
    // Status re-checked in the filter: an admin suspending the store at the same moment wins.
    { _id: store._id, ownerUserId: actor.id, status: trusted({ $in: [...EDITABLE] }) },
    {
      $set: {
        name: input.storeName,
        category: input.category,
        description: input.description ?? "",
        "contact.phone": input.phone ?? "",
        "contact.website": input.website,
        "contact.address": { line1: input.line1, city: input.city, state: input.state, zip: input.zip },
      },
      ...(input.website ? {} : { $unset: { "contact.website": 1 } }),
    },
    { runValidators: true },
  );
  if (res.matchedCount !== 1) return { ok: false, error: "readOnly" };
  await audit(actor.id, "store.profile_update", "store", String(store._id), { nameChanged: input.storeName !== store.name });
  return { ok: true };
}

// ── Photos ───────────────────────────────────────────────────────────────────────────
export async function addStorePhoto(actor: StoreActor, file: Blob): Promise<OwnerResult> {
  const store = await ownedStore(actor);
  if (!store) return { ok: false, error: "notFound" };
  if (!isEditable(store.status)) return { ok: false, error: "readOnly" };
  if (!(await hitRateLimit(`photo:store:${store._id}`, 30, 3600))) return { ok: false, error: "rateLimited" };
  const storeId = String(store._id);

  let image;
  try {
    image = await uploadPublicImage(file, { folder: "stores", ownerId: storeId });
  } catch (err) {
    if (err instanceof ImageUploadError) return { ok: false, error: err.code };
    throw err;
  }
  // Atomic cap: only push while there are fewer than 10 photos ("photos.9" doesn't exist).
  const res = await Store.updateOne(
    { _id: storeId, ownerUserId: actor.id, [`photos.${MAX_STORE_PHOTOS - 1}`]: trusted({ $exists: false }) },
    { $push: { photos: { url: image.url, pathname: image.pathname } } },
    { runValidators: true },
  );
  if (res.matchedCount !== 1) {
    await deletePublicImage(image.pathname, { folder: "stores", ownerId: storeId }); // don't leave an orphan file
    return { ok: false, error: "tooManyPhotos" };
  }
  await audit(actor.id, "store.photo_add", "store", storeId);
  return { ok: true };
}

export async function removeStorePhoto(actor: StoreActor, pathname: string): Promise<OwnerResult> {
  const store = await ownedStore(actor);
  if (!store) return { ok: false, error: "notFound" };
  if (!isEditable(store.status)) return { ok: false, error: "readOnly" };
  const storeId = String(store._id);
  // The pathname must be one of THIS store's files (checked before touching storage).
  if (!isOwnedImagePath(pathname, { folder: "stores", ownerId: storeId })) return { ok: false, error: "notFound" };
  const res = await Store.updateOne({ _id: storeId, ownerUserId: actor.id }, { $pull: { photos: { pathname } } });
  if (res.modifiedCount !== 1) return { ok: false, error: "notFound" };
  await deletePublicImage(pathname, { folder: "stores", ownerId: storeId }); // DB first, then the file
  await audit(actor.id, "store.photo_remove", "store", storeId);
  return { ok: true };
}

// ── Reps ─────────────────────────────────────────────────────────────────────────────
export type RepRow = { id: string; name?: string; email: string };
export type PendingInviteRow = { email: string; expiresAt: string };

export async function listReps(actor: StoreActor): Promise<{ reps: RepRow[]; invites: PendingInviteRow[] } | null> {
  const store = await ownedStore(actor);
  if (!store) return null;
  const full = await Store.findById(String(store._id)).select("repUserIds").lean();
  const [reps, invites] = await Promise.all([
    User.find({ _id: trusted({ $in: full?.repUserIds ?? [] }), role: "store_rep" }).select("name email").sort({ name: 1 }).lean(),
    ActionToken.find({ storeId: String(store._id), purpose: "invite_rep", usedAt: null, expiresAt: trusted({ $gt: new Date() }) })
      .select("email expiresAt")
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  return {
    reps: reps.map((r) => ({ id: String(r._id), name: r.name ?? undefined, email: r.email })),
    invites: invites.map((i) => ({ email: i.email, expiresAt: i.expiresAt.toISOString() })),
  };
}

/**
 * Invite a rep by email: a 7-day single-use link to the store app's /accept-rep-invite.
 *
 * Only APPROVED stores may invite (review finding 2026-11-05): an unreviewed store could
 * otherwise send emails carrying text it chose to any address. The email subject doesn't
 * include the store name either. Rate limits: per store, and per store+email (so one store
 * can't use up another store's ability to invite a person).
 * Allowed addresses: brand-new emails, or a rep previously REMOVED from a store. Any other
 * existing account → emailInUse (only an admin-reviewed store can learn this).
 * Older links for this person+store stop working only AFTER the new email is sent.
 */
export async function inviteRep(actor: StoreActor, email: string, locale: string, appOrigin: string): Promise<OwnerResult> {
  const store = await ownedStore(actor);
  if (!store) return { ok: false, error: "notFound" };
  if (store.status !== "approved") return { ok: false, error: "notApproved" };
  const storeId = String(store._id);
  const [storeOk, emailOk] = await Promise.all([
    hitRateLimit(`rep-invite:store:${storeId}`, 20, 86_400),
    hitRateLimit(`rep-invite:email:${storeId}:${emailKey(email)}`, 3, 86_400),
  ]);
  if (!storeOk || !emailOk) return { ok: false, error: "rateLimited" };

  const existing = await User.findOne({ email }).select("role status storeId").lean();
  const reusable = existing && existing.role === "store_rep" && existing.status === "suspended" && !existing.storeId;
  if (existing && !reusable) return { ok: false, error: "emailInUse" };

  const { raw, id } = await createActionToken("invite_rep", { email, storeId, createdByUserId: actor.id }, { cancelOlder: false });
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const link = new URL(localizePath("/accept-rep-invite", safeLocale), new URL(appOrigin).origin);
  link.searchParams.set("token", raw);
  try {
    await sendEmail({ to: email, locale: safeLocale, template: "inviteRep", values: { storeName: store.name, link: link.toString() } });
  } catch (err) {
    console.error("[stores] rep invite email failed:", err instanceof Error ? err.message : "unknown");
    await voidToken(id); // the earlier link (if any) keeps working
    return { ok: false, error: "emailFailed" };
  }
  await cancelOtherTokens("invite_rep", { email, storeId }, id);
  await audit(actor.id, "rep.invite", "store", storeId);
  return { ok: true };
}
/**
 * Remove a rep: take them off the store and suspend their login (their sessions end at the
 * next 5-minute re-check, and every store page re-checks membership immediately). The
 * account is kept (audit history) and can be re-invited later.
 */
export async function removeRep(actor: StoreActor, repUserId: string): Promise<OwnerResult> {
  const store = await ownedStore(actor);
  if (!store) return { ok: false, error: "notFound" };
  const storeId = String(store._id);
  const done = await withTransaction(async (session) => {
    const pulled = await Store.updateOne({ _id: storeId, ownerUserId: actor.id, repUserIds: repUserId }, { $pull: { repUserIds: repUserId } }, { session });
    if (pulled.modifiedCount !== 1) return false;
    await User.updateOne(
      { _id: repUserId, role: "store_rep", storeId },
      { $set: { status: "suspended" }, $unset: { storeId: 1 }, $inc: { sessionVersion: 1 } },
      { session },
    );
    await AuditLog.create([{ actorUserId: actor.id, action: "rep.remove", targetType: "user", targetId: repUserId, details: { storeId } }], { session });
    return true;
  });
  return done ? { ok: true } : { ok: false, error: "notFound" };
}
