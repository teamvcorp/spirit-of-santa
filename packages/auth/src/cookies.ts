/**
 * NextAuth cookie set. SERVER-ONLY. Naming rules (__Host- prefix in production, per-app
 * names on localhost) live in @repo/lib/cookies so the i18n locale cookie follows them too.
 */
import "server-only";
import type { CookiesOptions } from "next-auth";
import type { AppName } from "@repo/lib/roles";
import { cookieName, isProd } from "@repo/lib/cookies";

export { cookieName, isProd };

export function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: isProd(),
  };
}

/** Full NextAuth cookie set for one app. */
export function nextAuthCookies(app: AppName): CookiesOptions {
  const o = baseCookieOptions();
  const c = (name: string, extra: Record<string, unknown> = {}) => ({
    name: cookieName(app, name),
    options: { ...o, ...extra },
  });
  return {
    sessionToken: c("session-token"),
    callbackUrl: c("callback-url"),
    csrfToken: c("csrf-token"),
    pkceCodeVerifier: c("pkce", { maxAge: 60 * 15 }),
    state: c("state", { maxAge: 60 * 15 }),
    nonce: c("nonce"),
  };
}
