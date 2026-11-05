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

/** The signed-in user, or null (signed out, revoked, or foreign-app token). */
export async function getSessionUser(
  options: AuthOptions,
): Promise<SessionUser | null> {
  const session = await getServerSession(options);
  return session?.user ?? null;
}

/**
 * Signed-in user or redirect to our sign-in page. Pass `returnTo` (a path on this site,
 * e.g. "/wishlist") to come back after signing in; it is re-validated on the way back
 * by safeCallbackPath, so passing a request value here can't create an open redirect.
 */
export async function requireUser(options: AuthOptions, returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser(options);
  if (!user) {
    const safe = safeCallbackPath(returnTo, "");
    redirect(safe ? `/signin?callbackUrl=${encodeURIComponent(safe)}` : "/signin");
  }
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
