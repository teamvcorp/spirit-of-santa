/**
 * Account flows that send email: store sign-up, verify email, resend verification,
 * forgot / reset password. SERVER-ONLY. Called from each app's Server Actions, which
 * parse the form with schemas.ts first.
 *
 * Security principles applied throughout:
 *  - NO ACCOUNT ENUMERATION: "sign up", "forgot password" and "resend" answer exactly the
 *    same whether or not the email exists. The password is hashed on every path, and the
 *    Server Actions (form-actions.ts) pad every response to a minimum duration, so timing
 *    doesn't reveal it either.
 *    An existing user who "signs up" again gets an "you already have an account" email.
 *  - Rate limits per IP and per (hashed) email on every public action.
 *  - Single-use, short-lived, hashed link tokens (tokens.ts). Verify/reset links open a page
 *    with a button that POSTs; nothing happens on a plain GET, because email security
 *    scanners pre-fetch links and would otherwise burn (or trigger) them.
 *  - Resetting a password signs out every existing session (sessionVersion + 1) and clears
 *    the lockout. It also proves the email, so a pending account becomes active, but a
 *    SUSPENDED account stays suspended.
 */
import "server-only";
import { ActionToken, AuditLog, connectDb, Family, Store, trusted, User, withTransaction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import type { Locale } from "@repo/lib/locales";
import { isRoleAllowedInApp, isSelfSignupRole, type AppName } from "@repo/lib/roles";
import { PARENT_CONSENT_VERSION } from "@repo/lib/family";
import { STORE_AGREEMENT_VERSION } from "@repo/lib/store";
import { burnVerifyTime, hashSecret } from "./password.ts";
import { LOCKOUT_MINUTES } from "./options.ts";
import { clientIp, emailKey, hitRateLimit, ipKey } from "./rate-limit.ts";
import type { AcceptInviteInput, AcceptRepInviteInput, ParentRegistrationInput, StoreRegistrationInput } from "./schemas.ts";
import { slugify } from "./slug.ts";
import { consumeActionToken, createActionToken, hashToken, peekActionToken } from "./tokens.ts";

/** Per-request facts the app passes in. */
export type FlowContext = {
  headers: Headers;
  locale: Locale;
  /** This app's public origin, e.g. https://store.spiritofsanta.com (NEXTAUTH_URL). */
  appOrigin: string;
};

export type FlowResult = { ok: true } | { ok: false; error: "rateLimited" | "invalidLink" };

const HOUR = 3600;

/** Absolute, language-aware link to a page of this app. */
function appLink(ctx: FlowContext, path: string, token?: string): string {
  const url = new URL(localizePath(path, ctx.locale), ctx.appOrigin);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Send now; a failure is logged (no addresses/links in logs) but doesn't fail the request:
 * the account still exists and the user can use "resend" / "forgot password" again.
 * (We first used after() to send post-response, but it proved unreliable in dev; timing is
 * equalised by the minimum response time in form-actions.ts instead.)
 */
async function sendLater(task: () => Promise<void>, label: string) {
  try {
    await task();
  } catch (err) {
    console.error(`[email] ${label} failed:`, err instanceof Error ? err.message : "unknown");
  }
}

/**
 * Rate limits for a public action (review hardening 2026-11-05):
 *  - per IP (IPv6 grouped by /64, see ipKey) and optional site-wide cap → VISIBLE: the user
 *    sees "too many tries". These protect us from floods.
 *  - per email → SILENT: the request still "succeeds" but nothing is sent. A stranger who
 *    knows someone's email therefore can't use up that person's reset/verify emails and
 *    lock them out of recovery, and the answer never differs by email (no enumeration).
 * The per-email counter only counts requests that passed the IP check, in that order.
 */
type LimitOutcome = "ok" | "blocked" | "skipSend";
async function checkLimits(
  scope: string,
  ctx: FlowContext,
  email: string,
  limits: { perIp: number; perEmail: number; global?: number },
): Promise<LimitOutcome> {
  const ip = ipKey(clientIp(ctx.headers));
  if (!(await hitRateLimit(`${scope}:ip:${ip}`, limits.perIp, HOUR))) return "blocked";
  if (limits.global && !(await hitRateLimit(`${scope}:global`, limits.global, HOUR))) return "blocked";
  return (await hitRateLimit(`${scope}:email:${emailKey(email)}`, limits.perEmail, HOUR)) ? "ok" : "skipSend";
}

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

// ── Self sign-up (shared by stores and parents) ───────────────────────────────────────
/** Which confirm email fits the account (parents get family wording, store owners store wording). */
const verifyTemplate = (role: string) => (role === "parent" ? "verifyParentEmail" : "verifyEmail");

async function sendVerifyLink(email: string, userId: NonNullable<Parameters<typeof createActionToken>[1]["userId"]>, role: string, ctx: FlowContext) {
  const { raw } = await createActionToken("verify_email", { email, userId });
  const link = appLink(ctx, "/verify", raw);
  await sendLater(() => sendEmail({ to: email, locale: ctx.locale, template: verifyTemplate(role), values: { link } }), "verifyEmail");
}

/**
 * The security-critical part of BOTH sign-up flows in one place (review 2026-11-05), so a fix
 * can't land in one and be missed in the other:
 *  - visible per-IP / site-wide limits, silent per-email limit; honeypot → fake success;
 *  - the password is hashed on EVERY path (same cost whether or not the email exists);
 *  - an email that already exists gets the SAME answer, and by email:
 *      still unconfirmed in this app → a fresh confirm link (their old one may have expired),
 *      confirmed in this app          → "you already have an account" (sign-in link),
 *      an account of the OTHER app    → nothing (a link to a site where they can't sign in would
 *                                       only confuse; the answer on screen is identical).
 * `create` makes the user (+ store/family) in a transaction and returns its id, or null when
 * the same email was created a moment ago (unique index): also the same answer.
 */
async function selfSignUp(spec: {
  scope: string;
  limits: { perIp: number; perEmail: number; global?: number };
  app: AppName;
  role: "store_owner" | "parent";
  email: string;
  password: string;
  honeypot?: string;
  ctx: FlowContext;
  create: (passwordHash: string) => Promise<string | null>;
}): Promise<FlowResult> {
  await connectDb();
  const limit = await checkLimits(spec.scope, spec.ctx, spec.email, spec.limits);
  if (limit === "blocked") return { ok: false, error: "rateLimited" };
  if (limit === "skipSend") return { ok: true }; // silently: same answer, nothing created or sent
  if (spec.honeypot) return { ok: true }; // honeypot filled → a bot. Pretend success, do nothing.

  const passwordHash = await hashSecret(spec.password); // every path: same cost
  const existing = await User.findOne({ email: spec.email }).select("_id role status").lean();
  if (existing) {
    if (!isRoleAllowedInApp(existing.role, spec.app)) return { ok: true };
    if (existing.status === "pending" && isSelfSignupRole(existing.role)) {
      await sendVerifyLink(spec.email, existing._id, existing.role, spec.ctx);
    } else if (existing.status === "active") {
      const link = appLink(spec.ctx, "/signin");
      await sendLater(() => sendEmail({ to: spec.email, locale: spec.ctx.locale, template: "accountExists", values: { link } }), "accountExists");
    }
    return { ok: true };
  }
  const userId = await spec.create(passwordHash);
  if (userId) await sendVerifyLink(spec.email, userId, spec.role, spec.ctx);
  return { ok: true };
}

// ── Store sign-up ────────────────────────────────────────────────────────────────────
export async function registerStoreOwner(input: StoreRegistrationInput, ctx: FlowContext): Promise<FlowResult> {
  return selfSignUp({
    scope: "register",
    // Site-wide cap: a backstop if someone rotates through many IPs (sign-up spam relay).
    limits: { perIp: 5, perEmail: 3, global: 100 },
    app: "store",
    role: "store_owner",
    email: input.email,
    password: input.password,
    honeypot: input.company_url,
    ctx,
    async create(passwordHash) {
      let slug = slugify(input.storeName);
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await withTransaction(async (session) => {
            const [user] = await User.create(
              [{ email: input.email, passwordHash, role: "store_owner", name: input.ownerName, status: "pending", locale: ctx.locale }],
              { session },
            );
            const [store] = await Store.create(
              [
                {
                  name: input.storeName,
                  slug,
                  category: input.category,
                  description: input.description,
                  contact: {
                    email: input.email,
                    phone: input.phone,
                    website: input.website,
                    address: { line1: input.line1, city: input.city, state: input.state, zip: input.zip },
                  },
                  status: "pending",
                  ownerUserId: user!._id,
                  discountAgreement: { version: STORE_AGREEMENT_VERSION, acceptedAt: new Date(), acceptedByUserId: user!._id },
                },
              ],
              { session },
            );
            await User.updateOne({ _id: user!._id }, { $set: { storeId: store!._id } }, { session });
            return String(user!._id);
          });
        } catch (err) {
          const e = err as { code?: number; keyPattern?: Record<string, unknown> };
          if (e.code !== 11000) throw err;
          if (e.keyPattern?.email) return null; // same email signed up a moment ago
          slug = `${slugify(input.storeName).slice(0, 45)}-${randomSuffix()}`; // slug taken: try another
        }
      }
      throw new Error("could not allocate a store slug");
    },
  });
}

// ── Parent sign-up (family app) ──────────────────────────────────────────────────────
/**
 * Creates a PENDING parent + their Family with the consent record (policy version, time).
 * Confirming the email activates the account and stamps consent.emailVerifiedAt (verifyEmail).
 */
export async function registerParent(input: ParentRegistrationInput, ctx: FlowContext): Promise<FlowResult> {
  return selfSignUp({
    scope: "register-parent",
    limits: { perIp: 5, perEmail: 3, global: 200 },
    app: "family",
    role: "parent",
    email: input.email,
    password: input.password,
    honeypot: input.company_url,
    ctx,
    async create(passwordHash) {
      try {
        return await withTransaction(async (session) => {
          const [user] = await User.create(
            [{ email: input.email, passwordHash, role: "parent", name: input.parentName, status: "pending", locale: ctx.locale }],
            { session },
          );
          const [family] = await Family.create(
            [
              {
                ownerUserId: user!._id,
                familyName: input.familyName,
                ...(input.zip ? { zip: input.zip } : {}),
                consent: { version: PARENT_CONSENT_VERSION, acceptedAt: new Date() },
              },
            ],
            { session },
          );
          await User.updateOne({ _id: user!._id }, { $set: { familyId: family!._id } }, { session });
          return String(user!._id);
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return null; // same email a moment ago
        throw err;
      }
    },
  });
}

// ── Verify email ─────────────────────────────────────────────────────────────────────
export async function verifyEmail(raw: unknown): Promise<FlowResult> {
  await connectDb();
  const token = await consumeActionToken(raw, "verify_email");
  if (!token?.userId) return { ok: false, error: "invalidLink" };
  // Only pending → active (never re-activates a suspended account). For parents the confirmed
  // email is part of the COPPA consent record: both writes in ONE transaction, so an account is
  // never active without its consent stamp (review 2026-11-05).
  await withTransaction(async (session) => {
    const res = await User.updateOne({ _id: token.userId, status: "pending" }, { $set: { status: "active" } }, { session });
    if (res.modifiedCount === 1) {
      await Family.updateOne({ ownerUserId: token.userId, "consent.emailVerifiedAt": null }, { $set: { "consent.emailVerifiedAt": new Date() } }, { session });
    }
  });
  return { ok: true };
}

/** Resend the confirm link, for accounts of this app's roles only (store owners / parents). */
export async function resendVerification(email: string, ctx: FlowContext, app: AppName): Promise<FlowResult> {
  await connectDb();
  const limit = await checkLimits("resend", ctx, email, { perIp: 10, perEmail: 3 });
  if (limit === "blocked") return { ok: false, error: "rateLimited" };
  if (limit === "skipSend") return { ok: true };
  const user = await User.findOne({ email, status: "pending" }).select("_id role").lean();
  // Only self-sign-up roles of THIS app: a parent can't trigger a store email and vice versa.
  if (user && isSelfSignupRole(user.role) && isRoleAllowedInApp(user.role, app)) {
    await sendVerifyLink(email, user._id, user.role, ctx);
  }
  return { ok: true }; // same answer either way
}

// ── Forgot / reset password ──────────────────────────────────────────────────────────
export async function requestPasswordReset(email: string, app: AppName, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  const limit = await checkLimits("reset", ctx, email, { perIp: 10, perEmail: 5 });
  if (limit === "blocked") return { ok: false, error: "rateLimited" };
  if (limit === "skipSend") return { ok: true };
  const user = await User.findOne({ email }).select("_id role status").lean();
  if (user && user.status !== "suspended" && isRoleAllowedInApp(user.role, app)) {
    const { raw } = await createActionToken("reset_password", { email, userId: user._id });
    const link = appLink(ctx, "/reset-password", raw);
    await sendLater(() => sendEmail({ to: email, locale: ctx.locale, template: "resetPassword", values: { link } }), "resetPassword");
  }
  return { ok: true };
}

export async function resetPassword(raw: unknown, newPassword: string, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  // Hash first so a bad token and a good one take similar time.
  const passwordHash = await hashSecret(newPassword);
  const token = await consumeActionToken(raw, "reset_password");
  if (!token?.userId) {
    await burnVerifyTime(newPassword);
    return { ok: false, error: "invalidLink" };
  }
  const user = await User.findById(token.userId).select("email role status locale lockedUntil").lean();
  if (!user) return { ok: false, error: "invalidLink" };
  // A reset proves control of the mailbox, which clears a PASSWORD lockout (at most LOCKOUT_MINUTES). It must
  // NOT clear the LONGER lock from wrong authenticator codes (24 h): a mailbox holder could otherwise
  // reset → guess more codes → reset again (Phase 8 audit, 2026-11-06). Told apart by length, no new field.
  const keepLock = !!user.lockedUntil && user.lockedUntil.getTime() > Date.now() + LOCKOUT_MINUTES * 60_000;
  const activating = user.status === "pending";
  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: token.userId },
      {
        $set: { passwordHash, failedLoginCount: 0, ...(activating ? { status: "active" } : {}) },
        ...(keepLock ? {} : { $unset: { lockedUntil: 1 } }),
        $inc: { sessionVersion: 1 }, // sign out everywhere
      },
      { session },
    );
    // pending → active: for a parent, the clicked reset link proves the email just like the confirm link,
    // so stamp the COPPA consent record in the same transaction (an active parent always has the stamp).
    if (activating && user.role === "parent") {
      await Family.updateOne({ ownerUserId: token.userId, "consent.emailVerifiedAt": null }, { $set: { "consent.emailVerifiedAt": new Date() } }, { session });
    }
  });
  // Tell the OWNER (in their language): if it wasn't them, this is how they find out. Sent after the response.
  const link = appLink(ctx, "/signin");
  await sendLater(() => sendEmail({ to: user.email, locale: user.locale ?? ctx.locale, template: "passwordChanged", values: { link } }), "passwordChanged");
  return { ok: true };
}

// ── Cleanup of abandoned sign-ups ────────────────────────────────────────────────────
/**
 * Delete store sign-ups whose email was never confirmed within `olderThanHours` (default 48).
 * Run daily by Vercel Cron (apps/store/app/api/cron/purge-signups). Keeps spam/abandoned
 * sign-ups from piling up and frees the email/slug for a real owner (review 2026-11-05).
 * Only touches PENDING users whose stores are all still PENDING; never confirmed users, and never
 * the owner of a store an admin has already approved or rejected.
 */
export async function purgeUnverifiedStoreSignups(olderThanHours = 48): Promise<{ users: number; stores: number }> {
  await connectDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const users = await User.find({ status: "pending", role: "store_owner", createdAt: trusted({ $lt: cutoff }) })
    .select("_id")
    .limit(1000) // bounded batch per run
    .lean();
  if (users.length === 0) return { users: 0, stores: 0 };
  // Never delete an owner whose store already left "pending" (an admin approved/rejected it):
  // that would leave a store pointing at a deleted owner (review finding 2026-11-05).
  const keep = new Set(
    (await Store.distinct("ownerUserId", { ownerUserId: trusted({ $in: users.map((u) => u._id) }), status: trusted({ $ne: "pending" }) })).map(String),
  );
  const ids = users.map((u) => u._id).filter((id) => !keep.has(String(id)));
  if (ids.length === 0) return { users: 0, stores: 0 };
  const stores = await Store.deleteMany({ ownerUserId: trusted({ $in: ids }), status: "pending" });
  await ActionToken.deleteMany({ userId: trusted({ $in: ids }) });
  const deleted = await User.deleteMany({ _id: trusted({ $in: ids }), status: "pending" });
  return { users: deleted.deletedCount, stores: stores.deletedCount };
}
/**
 * Delete parent sign-ups never confirmed within `olderThanHours` (default 48), with their
 * Family (no kids can exist yet: kids are added after sign-in). Runs in the same daily cron as the
 * store purge (apps/store/app/api/cron/purge-signups: one shared database).
 */
export async function purgeUnverifiedParentSignups(olderThanHours = 48): Promise<{ users: number; families: number }> {
  await connectDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const users = await User.find({ status: "pending", role: "parent", createdAt: trusted({ $lt: cutoff }) }).select("_id").limit(1000).lean();
  if (users.length === 0) return { users: 0, families: 0 };
  // Re-check "still pending" INSIDE a transaction and delete only those users' families: a parent
  // who confirms while this runs keeps their family (review 2026-11-05).
  return withTransaction(async (session) => {
    const still = await User.find({ _id: trusted({ $in: users.map((u) => u._id) }), status: "pending", role: "parent" })
      .select("_id")
      .session(session)
      .lean();
    const ids = still.map((u) => u._id);
    if (ids.length === 0) return { users: 0, families: 0 };
    const families = await Family.deleteMany({ ownerUserId: trusted({ $in: ids }) }, { session });
    await ActionToken.deleteMany({ userId: trusted({ $in: ids }) }, { session });
    const deleted = await User.deleteMany({ _id: trusted({ $in: ids }) }, { session });
    return { users: deleted.deletedCount, families: families.deletedCount };
  });
}

// ── Store invite (admin invited the store; owner accepts) ────────────────────────────
/** Store name for the /accept-invite page, or null if the link is invalid/used/expired. */
export async function peekStoreInvite(raw: unknown): Promise<{ storeName: string; email: string } | null> {
  await connectDb();
  const token = await peekActionToken(raw, "invite_owner");
  if (!token?.storeId) return null;
  const store = await Store.findOne({ _id: token.storeId, status: "invited" }).select("name").lean();
  return store ? { storeName: store.name, email: token.email } : null;
}

/**
 * Accept an owner invite. In ONE transaction: use up the token, create the owner (active:
 * clicking the emailed link proves the address), and switch the store invited → approved
 * with the agreement recorded. If any step fails, nothing changes and the link still works.
 * The store is approved immediately because the admin already agreed the discount when
 * inviting it.
 */
export async function acceptStoreInvite(input: AcceptInviteInput, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  // argon2 per request: cap attempts per IP so this can't be used to burn CPU.
  if (!(await hitRateLimit(`invite:ip:${ipKey(clientIp(ctx.headers))}`, 20, HOUR))) return { ok: false, error: "rateLimited" };
  const passwordHash = await hashSecret(input.password);
  try {
    return await withTransaction(async (session): Promise<FlowResult> => {
      const now = new Date();
      const token = await ActionToken.findOneAndUpdate(
        { tokenHash: hashToken(input.token), purpose: "invite_owner", usedAt: null, expiresAt: trusted({ $gt: now }) },
        { $set: { usedAt: now } },
        { session, returnDocument: "after" },
      ).lean();
      if (!token?.storeId) return { ok: false, error: "invalidLink" };
      const existing = await User.findOne({ email: token.email }).select("status role").session(session).lean();
      if (existing) {
        // An UNCONFIRMED self-sign-up with this email (anyone can type any address into the
        // public form) must not block the invite: clicking the emailed link proves who owns
        // the address, so the squatter's pending account + pending store are removed
        // (review finding 2026-11-05). Any other existing account → refuse, keep the token.
        if (existing.status !== "pending" || existing.role !== "store_owner") throw new InviteNoLongerValid();
        await Store.deleteMany({ ownerUserId: existing._id, status: "pending" }, { session });
        await ActionToken.updateMany({ userId: existing._id, usedAt: null }, { $set: { usedAt: now } }, { session });
        await User.deleteOne({ _id: existing._id, status: "pending" }, { session });
      }

      const [user] = await User.create(
        [{ email: token.email, passwordHash, role: "store_owner", name: input.ownerName, status: "active", locale: ctx.locale, storeId: token.storeId }],
        { session },
      );
      const updated = await Store.updateOne(
        { _id: token.storeId, status: "invited" },
        {
          $set: {
            status: "approved",
            ownerUserId: user!._id,
            "contact.email": token.email,
            discountAgreement: { version: STORE_AGREEMENT_VERSION, acceptedAt: now, acceptedByUserId: user!._id },
            reviewedByAdminId: token.createdByUserId,
            reviewedAt: now,
          },
        },
        { session, runValidators: true },
      );
      if (updated.matchedCount !== 1) throw new InviteNoLongerValid(); // roll everything back
      await AuditLog.create(
        [{ actorUserId: user!._id, action: "store.invite_accepted", targetType: "store", targetId: token.storeId, details: { from: "invited", to: "approved" } }],
        { session },
      );
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof InviteNoLongerValid) return { ok: false, error: "invalidLink" };
    if ((err as { code?: number }).code === 11000) return { ok: false, error: "invalidLink" }; // email taken meanwhile
    throw err;
  }
}

class InviteNoLongerValid extends Error {
  constructor() {
    super("store is no longer in the invited state");
    this.name = "InviteNoLongerValid";
  }
}
// ── Rep invite (store owner invited a rep) ──────────────────────────────────────────
/** Store name for /accept-rep-invite, or null if the link is invalid/used/expired. */
export async function peekRepInvite(raw: unknown): Promise<{ storeName: string; email: string } | null> {
  await connectDb();
  const token = await peekActionToken(raw, "invite_rep");
  if (!token?.storeId) return null;
  const store = await Store.findOne({ _id: token.storeId, status: trusted({ $in: ["pending", "approved"] }) }).select("name").lean();
  return store ? { storeName: store.name, email: token.email } : null;
}

/**
 * Accept a rep invite, in ONE transaction: use up the token, create the rep (active: the
 * emailed link proves the address) or re-activate a rep who was removed from a store earlier,
 * and add them to the store's reps. Anything unexpected rolls back and the link keeps working.
 */
export async function acceptRepInvite(input: AcceptRepInviteInput, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  if (!(await hitRateLimit(`invite:ip:${ipKey(clientIp(ctx.headers))}`, 20, HOUR))) return { ok: false, error: "rateLimited" };
  const passwordHash = await hashSecret(input.password);
  try {
    return await withTransaction(async (session): Promise<FlowResult> => {
      const now = new Date();
      const token = await ActionToken.findOneAndUpdate(
        { tokenHash: hashToken(input.token), purpose: "invite_rep", usedAt: null, expiresAt: trusted({ $gt: now }) },
        { $set: { usedAt: now } },
        { session, returnDocument: "after" },
      ).lean();
      if (!token?.storeId) return { ok: false, error: "invalidLink" };
      const store = await Store.findOne({ _id: token.storeId, status: trusted({ $in: ["pending", "approved"] }) })
        .select("_id")
        .session(session)
        .lean();
      if (!store) throw new InviteNoLongerValid();

      const existing = await User.findOne({ email: token.email }).select("role status storeId suspendedByAdmin").session(session).lean();
      let repId;
      if (existing) {
        // Only a rep who was REMOVED from a store (suspended, no store) may be re-activated, and
        // never one an ADMIN suspended: a store can't undo an admin's decision (review 2026-11-05).
        if (existing.role !== "store_rep" || existing.status !== "suspended" || existing.storeId || existing.suspendedByAdmin) throw new InviteNoLongerValid();
        await User.updateOne(
          { _id: existing._id },
          {
            $set: { passwordHash, name: input.name, status: "active", storeId: store._id, failedLoginCount: 0, locale: ctx.locale },
            $unset: { lockedUntil: 1 },
            $inc: { sessionVersion: 1 },
          },
          { session },
        );
        repId = existing._id;
      } else {
        const [user] = await User.create(
          [{ email: token.email, passwordHash, role: "store_rep", name: input.name, status: "active", storeId: store._id, locale: ctx.locale }],
          { session },
        );
        repId = user!._id;
      }
      await Store.updateOne({ _id: store._id }, { $addToSet: { repUserIds: repId } }, { session });
      await AuditLog.create(
        [{ actorUserId: repId, action: "rep.accept", targetType: "store", targetId: store._id, details: { reactivated: !!existing } }],
        { session },
      );
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof InviteNoLongerValid) return { ok: false, error: "invalidLink" };
    if ((err as { code?: number }).code === 11000) return { ok: false, error: "invalidLink" };
    throw err;
  }
}