/**
 * Admin actions on stores. SERVER-ONLY. Called from the admin app's Server Actions, which
 * must pass the admin from requireRole(authOptions, "admin") (re-checked here too).
 *
 * Rules:
 *  - Every status change is ONE conditional update ("approve only if still pending"), so two
 *    admins clicking at once can't both act, and a stale page can't approve a store that was
 *    rejected meanwhile. Result tells the UI what happened.
 *  - Each change and its AuditLog row are written in one DB transaction.
 *  - Emails go out after the change is saved; an email failure is logged, not fatal.
 *
 * Status flow: invited → (owner accepts) approved
 *              pending → approved | rejected;  rejected → approved (second look)
 *              approved ⇄ suspended
 */
import "server-only";
import { ActionToken, AuditLog, connectDb, Store, STORE_STATUSES, trusted, User, withTransaction, type AuditAction, type DbSession } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { createActionToken } from "@repo/auth/tokens";
import { slugify } from "@repo/auth/slug";
import { storeAppOrigin } from "./urls.ts";
import type { InviteStoreInput } from "./schemas.ts";

export type AdminActor = { id: string; role: string };
type StoreStatus = (typeof STORE_STATUSES)[number];
/** The fields of a store we need after a transition (explicit, so types stay simple). */
type StoreBefore = { _id: { toString(): string }; name: string; status: StoreStatus; ownerUserId?: { toString(): string } | null };
export type AdminResult =
  | { ok: true; storeId?: string; emailFailed?: boolean }
  | { ok: false; error: "notFound" | "badStatus" | "emailInUse" | "ownerUnverified" | "alreadyInvited" };

function assertAdmin(actor: AdminActor) {
  // Defence in depth: the Server Action already called requireRole(..., "admin").
  if (actor.role !== "admin") throw new Error("admin role required");
}

async function audit(
  session: DbSession,
  actor: AdminActor,
  action: AuditAction,
  storeId: { toString(): string },
  details: Record<string, unknown>,
) {
  await AuditLog.create([{ actorUserId: actor.id, action, targetType: "store", targetId: String(storeId), details }], { session });
}

/** Email the store owner in their language; failures are logged without addresses. */
async function emailOwner(
  ownerUserId: unknown,
  build: (link: string) => Omit<Parameters<typeof sendEmail>[0], "to" | "locale">,
) {
  try {
    const owner = await User.findById(ownerUserId).select("email locale status").lean();
    // Only to a CONFIRMED owner: an unconfirmed address may belong to someone else, and these
    // emails contain the store name a stranger typed (review finding 2026-11-05: spam relay).
    if (!owner || owner.status !== "active") return;
    const locale = isLocale(owner.locale) ? owner.locale : DEFAULT_LOCALE;
    const link = new URL(localizePath("/signin", locale), storeAppOrigin()).toString();
    await sendEmail({ ...build(link), to: owner.email, locale } as Parameters<typeof sendEmail>[0]);
  } catch (err) {
    console.error("[stores] owner email failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** One atomic status transition + audit row. */
async function transition(
  actor: AdminActor,
  storeId: string,
  from: StoreStatus[],
  set: Record<string, unknown>,
  action: AuditAction,
  details: Record<string, unknown> = {},
  unset: Record<string, 1> = {},
) {
  assertAdmin(actor);
  await connectDb();
  return withTransaction(async (session) => {
    const before = await Store.findOneAndUpdate(
      // status filter = the atomic guard. Values are our own constants (no user input), but
      // $in is still an operator we write, so it's marked trusted for sanitizeFilter.
      { _id: storeId, status: trusted({ $in: from }) },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { session, runValidators: true },
    )
      .select("name status ownerUserId")
      .lean<StoreBefore>();
    if (!before) return null;
    await audit(session, actor, action, before._id, { from: before.status, to: set.status ?? before.status, ...details });
    return before;
  });
}

async function explain(storeId: string): Promise<AdminResult> {
  const exists = await Store.exists({ _id: storeId });
  return { ok: false, error: exists ? "badStatus" : "notFound" };
}

export async function approveStore(actor: AdminActor, storeId: string, discountBps: number): Promise<AdminResult> {
  // An owner who never confirmed their email can't run the store (and the daily purge would
  // delete them), so approval waits until they confirm (review finding 2026-11-05).
  await connectDb();
  const target = await Store.findById(storeId).select("ownerUserId").lean();
  if (!target) return { ok: false, error: "notFound" };
  const ownerActive = target.ownerUserId ? await User.exists({ _id: target.ownerUserId, status: "active" }) : null;
  if (!ownerActive) return { ok: false, error: "ownerUnverified" };
  const before = await transition(
    actor,
    storeId,
    ["pending", "rejected"],
    { status: "approved", discountBps, reviewedByAdminId: actor.id, reviewedAt: new Date() },
    "store.approve",
    { discountBps },
    { rejectionReason: 1 },
  );
  if (!before) return explain(storeId);
  await emailOwner(before.ownerUserId, (link) => ({
    template: "storeApproved",
    values: { storeName: before.name, link },
    idempotencyKey: `store-approved/${storeId}/${Date.now()}`,
  }));
  return { ok: true };
}

export async function rejectStore(actor: AdminActor, storeId: string, reason: string): Promise<AdminResult> {
  const before = await transition(
    actor,
    storeId,
    ["pending"],
    { status: "rejected", rejectionReason: reason, reviewedByAdminId: actor.id, reviewedAt: new Date() },
    "store.reject",
  );
  if (!before) return explain(storeId);
  await emailOwner(before.ownerUserId, (link) => ({
    template: "storeRejected",
    values: { storeName: before.name, reason, link },
  }));
  return { ok: true };
}

export async function suspendStore(actor: AdminActor, storeId: string, reason: string): Promise<AdminResult> {
  const before = await transition(actor, storeId, ["approved"], { status: "suspended" }, "store.suspend", { reason });
  return before ? { ok: true } : explain(storeId);
}

export async function reinstateStore(actor: AdminActor, storeId: string): Promise<AdminResult> {
  const before = await transition(actor, storeId, ["suspended"], { status: "approved" }, "store.reinstate");
  return before ? { ok: true } : explain(storeId);
}

/**
 * Change the agreed discount. Applies to items funded from now on; wholesale amounts already
 * locked for funded items are stored on those items and don't change (slice 4).
 */
export async function setStoreDiscount(actor: AdminActor, storeId: string, discountBps: number): Promise<AdminResult> {
  assertAdmin(actor);
  await connectDb();
  const before = await withTransaction(async (session) => {
    const prev = await Store.findOneAndUpdate({ _id: storeId }, { $set: { discountBps } }, { session, runValidators: true })
      .select("discountBps")
      .lean<{ _id: { toString(): string }; discountBps?: number }>();
    if (prev) await audit(session, actor, "store.discount", prev._id, { from: prev.discountBps ?? null, to: discountBps });
    return prev;
  });
  return before ? { ok: true } : { ok: false, error: "notFound" };
}

/**
 * Invite a store directly (bypasses self-signup). Creates the store as "invited" with the
 * agreed discount, and emails the owner a 7-day single-use link to the store app's
 * /accept-invite page, where they set their name + password and accept the agreement.
 */
export async function inviteStore(actor: AdminActor, input: InviteStoreInput, locale: string): Promise<AdminResult> {
  assertAdmin(actor);
  await connectDb();
  // Admins may learn whether an email is taken (they're trusted staff): clearer than a silent no-op.
  // An UNCONFIRMED self-sign-up doesn't count: anyone can type any email into the public form, so
  // it must not be able to block an invite (accepting the invite replaces it; review 2026-11-05).
  if (await User.exists({ email: input.ownerEmail, status: trusted({ $ne: "pending" }) })) return { ok: false, error: "emailInUse" };
  if (await Store.exists({ status: "invited", "contact.email": input.ownerEmail })) return { ok: false, error: "alreadyInvited" };

  let storeId: string | null = null;
  let slug = slugify(input.storeName);
  for (let attempt = 0; attempt < 4 && !storeId; attempt++) {
    try {
      storeId = await withTransaction(async (session) => {
        const [store] = await Store.create(
          [
            {
              name: input.storeName,
              slug,
              category: input.category,
              status: "invited",
              discountBps: input.discountBps,
              contact: { email: input.ownerEmail },
              invitedByAdminId: actor.id,
            },
          ],
          { session },
        );
        await audit(session, actor, "store.invite", store!._id, { discountBps: input.discountBps });
        return String(store!._id);
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      slug = `${slugify(input.storeName).slice(0, 45)}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }
  if (!storeId) throw new Error("could not allocate a store slug");

  const emailFailed = !(await sendOwnerInvite(actor, storeId, input.ownerEmail, input.storeName, locale));
  return { ok: true, storeId, emailFailed };
}

/** New single-use invite link for an invited store (older links stop working). true = email sent. */
async function sendOwnerInvite(actor: AdminActor, storeId: string, email: string, storeName: string, locale: string): Promise<boolean> {
  const { raw } = await createActionToken("invite_owner", { email, storeId, createdByUserId: actor.id });
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const link = new URL(localizePath("/accept-invite", safeLocale), storeAppOrigin());
  link.searchParams.set("token", raw);
  try {
    await sendEmail({ to: email, locale: safeLocale, template: "inviteOwner", values: { storeName, link: link.toString() } });
    return true;
  } catch (err) {
    console.error("[stores] invite email failed:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

/** Resend the invitation for a still-invited store (e.g. the email was lost or expired). */
export async function resendStoreInvite(actor: AdminActor, storeId: string, locale: string): Promise<AdminResult> {
  assertAdmin(actor);
  await connectDb();
  const store = await Store.findOne({ _id: storeId, status: "invited" }).select("name contact.email").lean();
  if (!store?.contact?.email) return explain(storeId);
  const sent = await sendOwnerInvite(actor, storeId, store.contact.email, store.name, locale);
  await AuditLog.create({ actorUserId: actor.id, action: "store.invite_resent", targetType: "store", targetId: storeId, details: { emailSent: sent } });
  return { ok: true, storeId, emailFailed: !sent };
}

/** Cancel an invitation: the invited store is deleted and its links stop working. */
export async function cancelStoreInvite(actor: AdminActor, storeId: string): Promise<AdminResult> {
  assertAdmin(actor);
  await connectDb();
  const removed = await withTransaction(async (session) => {
    const store = await Store.findOneAndDelete({ _id: storeId, status: "invited" }, { session }).select("_id").lean();
    if (!store) return false;
    await ActionToken.updateMany({ storeId, purpose: "invite_owner", usedAt: null }, { $set: { usedAt: new Date() } }, { session });
    await audit(session, actor, "store.invite_cancelled", storeId, {});
    return true;
  });
  return removed ? { ok: true } : explain(storeId);
}