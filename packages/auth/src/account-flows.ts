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
import { ActionToken, AuditLog, connectDb, Store, trusted, User, withTransaction } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import type { Locale } from "@repo/lib/locales";
import { isRoleAllowedInApp, type AppName } from "@repo/lib/roles";
import { STORE_AGREEMENT_VERSION } from "@repo/lib/store";
import { burnVerifyTime, hashSecret } from "./password.ts";
import { clientIp, emailKey, hitRateLimit, ipKey } from "./rate-limit.ts";
import type { AcceptInviteInput, StoreRegistrationInput } from "./schemas.ts";
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

// ── Store sign-up ────────────────────────────────────────────────────────────────────
export async function registerStoreOwner(input: StoreRegistrationInput, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  // Site-wide cap: a backstop if someone rotates through many IPs (sign-up spam relay).
  const limit = await checkLimits("register", ctx, input.email, { perIp: 5, perEmail: 3, global: 100 });
  if (limit === "blocked") return { ok: false, error: "rateLimited" };
  if (limit === "skipSend") return { ok: true }; // silently: same answer, nothing created or sent

  // Honeypot filled → a bot. Pretend success, do nothing.
  if (input.company_url) return { ok: true };

  // Hash on EVERY path (same cost whether or not the email exists).
  const passwordHash = await hashSecret(input.password);
  const existing = await User.exists({ email: input.email });
  if (existing) {
    const link = appLink(ctx, "/signin");
    await sendLater(() => sendEmail({ to: input.email, locale: ctx.locale, template: "accountExists", values: { link } }), "accountExists");
    return { ok: true };
  }

  let created: { userId: string } | null = null;
  let slug = slugify(input.storeName);
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    try {
      created = await withTransaction(async (session) => {
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
        return { userId: String(user!._id) };
      });
    } catch (err) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (e.code !== 11000) throw err;
      if (e.keyPattern?.email) return { ok: true }; // same email signed up a moment ago
      slug = `${slugify(input.storeName).slice(0, 45)}-${randomSuffix()}`; // slug taken: try another
    }
  }
  if (!created) throw new Error("could not allocate a store slug");

  const { raw } = await createActionToken("verify_email", { email: input.email, userId: created.userId });
  const link = appLink(ctx, "/verify", raw);
  await sendLater(
    () => sendEmail({ to: input.email, locale: ctx.locale, template: "verifyEmail", values: { link } }),
    "verifyEmail",
  );
  return { ok: true };
}

// ── Verify email ─────────────────────────────────────────────────────────────────────
export async function verifyEmail(raw: unknown): Promise<FlowResult> {
  await connectDb();
  const token = await consumeActionToken(raw, "verify_email");
  if (!token?.userId) return { ok: false, error: "invalidLink" };
  // Only pending → active. Never re-activates a suspended account.
  await User.updateOne({ _id: token.userId, status: "pending" }, { $set: { status: "active" } });
  return { ok: true };
}

export async function resendVerification(email: string, ctx: FlowContext): Promise<FlowResult> {
  await connectDb();
  const limit = await checkLimits("resend", ctx, email, { perIp: 10, perEmail: 3 });
  if (limit === "blocked") return { ok: false, error: "rateLimited" };
  if (limit === "skipSend") return { ok: true };
  const user = await User.findOne({ email, status: "pending", role: "store_owner" }).select("_id").lean();
  if (user) {
    const { raw } = await createActionToken("verify_email", { email, userId: user._id });
    const link = appLink(ctx, "/verify", raw);
    await sendLater(
      () => sendEmail({ to: email, locale: ctx.locale, template: "verifyEmail", values: { link } }),
      "verifyEmail",
    );
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

export async function resetPassword(raw: unknown, newPassword: string): Promise<FlowResult> {
  await connectDb();
  // Hash first so a bad token and a good one take similar time.
  const passwordHash = await hashSecret(newPassword);
  const token = await consumeActionToken(raw, "reset_password");
  if (!token?.userId) {
    await burnVerifyTime(newPassword);
    return { ok: false, error: "invalidLink" };
  }
  const user = await User.findById(token.userId).select("status").lean();
  if (!user) return { ok: false, error: "invalidLink" };
  await User.updateOne(
    { _id: token.userId },
    {
      $set: { passwordHash, failedLoginCount: 0, ...(user.status === "pending" ? { status: "active" } : {}) },
      $unset: { lockedUntil: 1 },
      $inc: { sessionVersion: 1 }, // sign out everywhere
    },
  );
  return { ok: true };
}

// ── Cleanup of abandoned sign-ups ────────────────────────────────────────────────────
/**
 * Delete store sign-ups whose email was never confirmed within `olderThanHours` (default 48).
 * Run daily by Vercel Cron (apps/store/app/api/cron/purge-signups). Keeps spam/abandoned
 * sign-ups from piling up and frees the email/slug for a real owner (review 2026-11-05).
 * Only touches PENDING users and their PENDING stores; never verified or approved ones.
 */
export async function purgeUnverifiedStoreSignups(olderThanHours = 48): Promise<{ users: number; stores: number }> {
  await connectDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const users = await User.find({ status: "pending", role: "store_owner", createdAt: trusted({ $lt: cutoff }) })
    .select("_id")
    .limit(1000) // bounded batch per run
    .lean();
  if (users.length === 0) return { users: 0, stores: 0 };
  const ids = users.map((u) => u._id);
  const stores = await Store.deleteMany({ ownerUserId: trusted({ $in: ids }), status: "pending" });
  await ActionToken.deleteMany({ userId: trusted({ $in: ids }) });
  const deleted = await User.deleteMany({ _id: trusted({ $in: ids }), status: "pending" });
  return { users: deleted.deletedCount, stores: stores.deletedCount };
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
      if (await User.exists({ email: token.email }).session(session)) return { ok: false, error: "invalidLink" };

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