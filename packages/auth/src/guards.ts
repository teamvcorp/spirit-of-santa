/**
 * Authorization helpers for Server Components, Server Actions and Route Handlers.
 * SERVER-ONLY.
 *
 * Check auth WHERE THE DATA IS READ OR CHANGED, not only in proxy/middleware. A
 * middleware-only check can be bypassed (see CVE-2025-29927), and Server Actions are public
 * POST endpoints that anyone can call directly.
 *
 *   const user = await requireRole(authOptions, "parent");
 *   // ...then also scope every query to user.familyId / user.storeId.
 */
import "server-only";
import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import type { Role } from "@repo/lib/roles";
import { safeCallbackPath } from "./redirect.ts";

export type SessionUser = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getServerSession<AuthOptions>>>>["user"]
>;

/** The raw session user, restricted (mfaSetup) sessions included. Internal. */
async function sessionUser(options: AuthOptions): Promise<SessionUser | null> {
  const session = await getServerSession(options);
  return session?.user ?? null;
}

/**
 * The signed-in user, or null (signed out, revoked, or foreign-app token).
 * A restricted session (admin who hasn't set up MFA) counts as signed OUT here unless the
 * caller opts in with `includeRestricted`: so a page that reads the session directly can't
 * forget the MFA check and show admin data (review 2026-11-05). Opt in only for UI that shows
 * no data (account menu) or that redirects restricted users itself.
 */
export async function getSessionUser(
  options: AuthOptions,
  { includeRestricted = false }: { includeRestricted?: boolean } = {},
): Promise<SessionUser | null> {
  const user = await sessionUser(options);
  if (user?.mfaSetup && !includeRestricted) return null;
  return user;
}

/**
 * Signed-in user or redirect to our sign-in page. Pass `returnTo` (a path on this site,
 * e.g. "/wishlist") to come back after signing in; it is re-validated on the way back
 * by safeCallbackPath, so passing a request value here can't create an open redirect.
 * A restricted (no-MFA-yet) admin session is sent to /mfa/setup instead.
 */
export async function requireUser(options: AuthOptions, returnTo?: string): Promise<SessionUser> {
  const user = await sessionUser(options);
  if (!user) {
    const safe = safeCallbackPath(returnTo, "");
    redirect(safe ? `/signin?callbackUrl=${encodeURIComponent(safe)}` : "/signin");
  }
  // An admin who hasn't set up MFA may do NOTHING else: every page and Server Action that
  // checks auth goes through here. Only /mfa/setup uses requireMfaSetupUser() instead.
  if (user.mfaSetup) redirect("/mfa/setup");
  return user;
}

/**
 * Signed-in user holding one of `roles`, else 404. A 404 (not 403) avoids confirming that
 * an admin-only page exists.
 */
export async function requireRole(
  options: AuthOptions,
  ...roles: Role[]
): Promise<SessionUser> {
  const user = await requireUser(options);
  if (!roles.includes(user.role)) notFound(); // 404, not 403: don't reveal the page exists
  return user;
}

/**
 * For the MFA setup page and its actions ONLY: a signed-in admin, with or without MFA yet.
 * Everything else must use requireUser()/requireRole(), which refuse restricted sessions.
 */
export async function requireMfaSetupUser(options: AuthOptions): Promise<SessionUser> {
  const user = await sessionUser(options);
  if (!user) redirect("/signin");
  if (user.role !== "admin") notFound();
  return user;
}
