/**
 * NextAuth (v4) configuration factory. SERVER-ONLY. Each app calls it once:
 *
 *   // apps/family/auth.ts
 *   export const authOptions = createAuthOptions("family");
 *
 * Security model:
 *  - Credentials (email + password) → argon2id verify → JWT session in an HttpOnly cookie.
 *  - Each app only admits its own roles (APP_ROLES); the token is also pinned to its app.
 *  - 5 bad passwords → 15 min lockout. Errors never reveal whether an email exists.
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
import { nextAuthCookies } from "./cookies.ts";
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
  }
  interface Session {
    user?: {
      id: string;
      role: Role;
      email: string;
      familyId?: string;
      storeId?: string;
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
    invalid?: boolean; // set when the user was suspended / sessions revoked
  }
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const RECHECK_MS = 5 * 60 * 1000;

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
        },
        async authorize(raw) {
          // next-auth v4 copies any error thrown here into the redirect URL
          // (?error=<message>), which would show DB/driver internals to users. So catch
          // everything, log it server-side, and return the generic failure.
          try {
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

/** Email + password check with lockout. Returns the user for the session, or null. */
async function verifyCredentials(raw: unknown, app: AppName) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return GENERIC_FAILURE;
  const { email, password } = parsed.data;

  await connectDb();
  const user = await User.findOne({ email }).select(
    "+passwordHash +failedLoginCount +lockedUntil",
  );
  if (!user) {
    await burnVerifyTime(password); // equalise timing with the "wrong password" path
    return GENERIC_FAILURE;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return GENERIC_FAILURE;

  const ok = await verifySecret(password, user.passwordHash);
  if (!ok) {
    // Atomic increment so parallel guesses can't race past the limit.
    const after = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { returnDocument: "after", projection: { failedLoginCount: 1 } },
    ).select("+failedLoginCount");
    if ((after?.failedLoginCount ?? 0) >= MAX_FAILED_LOGINS) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
            failedLoginCount: 0,
          },
        },
      );
    }
    return GENERIC_FAILURE;
  }

  // Correct password, but still refuse suspended users and other apps' roles.
  if (user.status === "suspended" || !isRoleAllowedInApp(user.role, app)) {
    return GENERIC_FAILURE;
  }
  if (app === "admin" && user.status !== "active") return GENERIC_FAILURE;

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
  };
}

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
          checkedAt: Date.now(),
        };
      }
      if (token.invalid || token.app !== app)
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
      };
      return session;
    },
  };
}
