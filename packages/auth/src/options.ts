/**
 * NextAuth (v4) configuration factory. SERVER-ONLY. Each app calls it once:
 *
 *   // apps/family/auth.ts
 *   export const authOptions = createAuthOptions("family");
 *
 * Security model:
 *  - Credentials (email + password) → argon2id verify → JWT session in an HttpOnly cookie.
 *  - Each app only admits its own roles (APP_ROLES); the token is also pinned to its app.
 *  - 5 bad passwords (or bad authenticator codes) → 15 min lockout. Errors never reveal
 *    whether an email exists, or which of password / code was wrong.
 *  - Admins need a second factor (mfa.ts). An admin without MFA yet gets a restricted
 *    `mfaSetup` session that can only open /mfa/setup (guards.ts).
 *  - Every 5 min the JWT re-checks the user in the DB, so suspending a user or bumping
 *    sessionVersion ends their sessions within minutes (pure JWTs can't be revoked otherwise).
 * Notes: docs/vendor/next-auth-v4.md
 */
import "server-only";
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { connectDb, User } from "@repo/db";
import { isRoleAllowedInApp, type AppName, type Role } from "@repo/lib/roles";
import { failAttempt, releaseAttempt, reserveAttempt, type AttemptRule } from "./attempts.ts";
import { nextAuthCookies } from "./cookies.ts";
import { clientIp, hitRateLimit, ipKey } from "./rate-limit.ts";
import { recordMfaFailure, verifySecondFactor } from "./mfa.ts";
import {
  burnVerifyTime,
  hashSecret,
  MAX_SECRET_LENGTH,
  needsRehash,
  verifySecret,
} from "./password.ts";

// ── Session typing (module augmentation) ────────────────────────────────────────────
declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    sessionVersion: number;
    familyId?: string;
    storeId?: string;
    /** Admin signed in with a password but hasn't set up MFA: setup page only. */
    mfaSetup?: boolean;
  }
  interface Session {
    user?: {
      id: string;
      role: Role;
      email: string;
      familyId?: string;
      storeId?: string;
      mfaSetup?: boolean;
    };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    app?: AppName;
    sv?: number; // sessionVersion at issue time
    familyId?: string;
    storeId?: string;
    checkedAt?: number; // last DB re-check (ms)
    mfaSetup?: boolean; // restricted admin session (no MFA yet)
    mfaV?: number; // admin tokens issued by the MFA-aware sign-in carry ADMIN_TOKEN_VERSION
    invalid?: boolean; // set when the user was suspended / sessions revoked
  }
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Sign-in tries per IP (IPv6: per /64) per app per 15 min, all accounts together. */
const SIGNIN_PER_IP = 50;
const RECHECK_MS = 5 * 60 * 1000;
/**
 * Stamped on every admin token at sign-in. Admin tokens WITHOUT it were issued before admin
 * MFA existed (they'd carry no mfaSetup flag and skip MFA), so they're treated as signed out.
 * Bump to force every admin to sign in again after a future change to admin sign-in.
 */
const ADMIN_TOKEN_VERSION = 1;

/** Session lifetime per app: shorter where the blast radius is larger. */
const SESSION_MAX_AGE: Record<AppName, number> = {
  family: 30 * 24 * 60 * 60, // home devices; the parent dashboard is separately PIN-locked
  store: 7 * 24 * 60 * 60,
  admin: 8 * 60 * 60, // one working day
};

const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(MAX_SECRET_LENGTH),
  /** Authenticator code (6 digits) or a recovery code. Optional: only MFA users need it. */
  code: z.string().trim().max(32).optional(),
});

/** Same message for every failure: unknown email, wrong password, locked, wrong app. */
const GENERIC_FAILURE = null;

export function createAuthOptions(app: AppName): AuthOptions {
  return {
    secret: process.env.NEXTAUTH_SECRET, // next-auth refuses to run in production without it
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE[app] },
    cookies: nextAuthCookies(app),
    // Our own translated page (apps/<app>/app/[locale]/signin) instead of next-auth's
    // unstyled default. Errors land there too as ?error=..., shown as one generic message.
    // The proxy adds the language prefix (/es/signin) from the locale cookie.
    pages: { signIn: "/signin", error: "/signin" },
    providers: [
      CredentialsProvider({
        name: "Email",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
          code: { label: "Authenticator code", type: "text" },
        },
        async authorize(raw, req) {
          // next-auth v4 copies any error thrown here into the redirect URL
          // (?error=<message>), which would show DB/driver internals to users. So catch
          // everything, log it server-side, and return the generic failure.
          try {
            // Per-IP cap (Phase 8 audit): the per-account lockout can't see one attacker trying
            // MANY accounts ("credential stuffing"). Generous for shared/home networks. Off in dev:
            // every local test signs in from the same address.
            if (process.env.NODE_ENV !== "development") {
              const ip = ipKey(clientIp(new Headers((req?.headers ?? {}) as Record<string, string>)));
              if (!(await hitRateLimit(`signin:ip:${ip}:${app}`, SIGNIN_PER_IP, 15 * 60))) return refuse("rate_limited", app);
            }
            return await verifyCredentials(raw, app);
          } catch (err) {
            console.error(
              "[auth] sign-in error:",
              err instanceof Error ? `${err.name}: ${err.message}` : "unknown",
            );
            return GENERIC_FAILURE;
          }
        },
      }),
    ],
    callbacks: authCallbacks(app),
  };
}

/**
 * Why a sign-in was refused, logged SERVER-SIDE only (Vercel → Logs: "[auth] sign-in refused").
 * The visitor always sees the same generic message (no account enumeration); the log names the
 * reason + the database searched, so "it says wrong password but the account exists" is
 * diagnosable (2026-11-06). Never logs the email, password or code.
 */
type RefuseReason = "rate_limited" | "bad_input" | "no_account" | "locked" | "bad_password" | "not_active" | "wrong_app" | "code_missing" | "code_wrong" | "code_reused";
function refuse(reason: RefuseReason, app: AppName, db?: string): null {
  console.warn(`[auth] sign-in refused (${app}): ${reason}${db ? ` · db=${db}` : ""}`);
  return GENERIC_FAILURE;
}

/** Email + password check with lockout. Returns the user for the session, or null. */
async function verifyCredentials(raw: unknown, app: AppName) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return refuse("bad_input", app);
  const { email, password, code } = parsed.data;

  const db = (await connectDb()).connection.name;
  const user = await User.findOne({ email }).select(
    "+passwordHash +failedLoginCount +lockedUntil",
  );
  if (!user) {
    await burnVerifyTime(password); // equalise timing with the "wrong password" path
    return refuse("no_account", app, db);
  }
  // Take a try BEFORE verifying (attempts.ts): parallel guesses can't race past the limit.
  const me = { _id: user._id };
  if (!(await reserveAttempt(User, me, LOGIN_ATTEMPTS))) {
    // Same cost as the other failure paths, so a fast answer can't reveal "this email exists
    // and is locked" (review finding 2026-11-05).
    await burnVerifyTime(password);
    return refuse("locked", app, db);
  }

  const ok = await verifySecret(password, user.passwordHash);
  if (!ok) {
    await failAttempt(User, me, LOGIN_ATTEMPTS);
    return refuse("bad_password", app, db);
  }

  // Correct password, but still refuse other apps' roles and any account that isn't active:
  // "pending" = email not verified yet (sign-up flow), "suspended" = blocked by admin.
  // Same generic failure, so the response never reveals which case applies. Not a strike.
  if (user.status !== "active" || !isRoleAllowedInApp(user.role, app)) {
    await releaseAttempt(User, me, LOGIN_ATTEMPTS);
    return refuse(user.status !== "active" ? "not_active" : "wrong_app", app, db);
  }

  // Second factor. Checked only AFTER the password, so codes can't be guessed without it.
  // A blank code isn't a strike (they may be reaching for their phone); a wrong one is.
  const mfaOn = user.mfa?.enabled === true;
  if (mfaOn) {
    if (!code) {
      await releaseAttempt(User, me, LOGIN_ATTEMPTS);
      return refuse("code_missing", app, db);
    }
    const second = await verifySecondFactor(user._id.toString(), code);
    if (second === "wrong") {
      await failAttempt(User, me, LOGIN_ATTEMPTS);
      await recordMfaFailure(user._id.toString()); // 10 in a row → 24 h lock
      return refuse("code_wrong", app, db);
    }
    if (second === "replay") {
      await releaseAttempt(User, me, LOGIN_ATTEMPTS); // a used-up but correct code: no strike
      return refuse("code_reused", app, db);
    }
  }

  const update: Record<string, unknown> = {
    failedLoginCount: 0,
    lastLoginAt: new Date(),
  };
  if (needsRehash(user.passwordHash))
    update.passwordHash = await hashSecret(password);
  await User.updateOne(
    { _id: user._id },
    { $set: update, $unset: { lockedUntil: 1 } },
  );

  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
    familyId: user.familyId?.toString(),
    storeId: user.storeId?.toString(),
    // Admins must set up MFA before anything else (guards.ts sends them to /mfa/setup).
    mfaSetup: user.role === "admin" && !mfaOn ? true : undefined,
  };
}

/**
 * The account-password lockout rule. EVERY place that checks an account password must use it with
 * reserveAttempt/failAttempt (attempts.ts), e.g. the parent PIN setup, or it becomes a guessing
 * endpoint that skips the lockout.
 */
export const LOGIN_ATTEMPTS: AttemptRule = {
  count: "failedLoginCount",
  lock: "lockedUntil",
  max: MAX_FAILED_LOGINS,
  lockMs: LOCKOUT_MINUTES * 60_000,
};

function authCallbacks(app: AppName): AuthOptions["callbacks"] {
  return {
    async jwt({ token, user }) {
      if (user) {
        // First call right after authorize(): stamp the token.
        return {
          ...token,
          uid: user.id,
          role: user.role,
          app,
          sv: user.sessionVersion,
          familyId: user.familyId,
          storeId: user.storeId,
          mfaSetup: user.mfaSetup,
          ...(app === "admin" ? { mfaV: ADMIN_TOKEN_VERSION } : {}),
          checkedAt: Date.now(),
        };
      }
      if (token.invalid || token.app !== app)
        return { ...token, invalid: true };
      // Admin token from before MFA (or an older admin sign-in version): sign in again.
      if (app === "admin" && token.mfaV !== ADMIN_TOKEN_VERSION)
        return { ...token, invalid: true };

      // Periodic revocation check.
      if (!token.checkedAt || Date.now() - token.checkedAt > RECHECK_MS) {
        await connectDb();
        const fresh = await User.findById(token.uid).select(
          "status role sessionVersion",
        );
        const revoked =
          !fresh ||
          fresh.status === "suspended" ||
          fresh.sessionVersion !== token.sv ||
          fresh.role !== token.role ||
          !isRoleAllowedInApp(fresh.role, app);
        return revoked
          ? { ...token, invalid: true }
          : { ...token, checkedAt: Date.now() };
      }
      return token;
    },
    async session({ session, token }) {
      // Revoked or foreign tokens produce a session with no user → treated as signed out.
      if (token.invalid || token.app !== app || !token.uid || !token.role) {
        delete session.user;
        return session;
      }
      session.user = {
        id: token.uid,
        role: token.role,
        email: token.email ?? "",
        familyId: token.familyId,
        storeId: token.storeId,
        ...(token.mfaSetup ? { mfaSetup: true } : {}),
      };
      return session;
    },
  };
}
