/**
 * Cookie naming. SERVER-ONLY.
 *
 * Production: `__Host-` prefix. Browsers then REQUIRE Secure, Path=/ and NO Domain
 * attribute, so a family cookie can never be sent to admin.spiritofsanta.com (and a
 * compromised subdomain can't plant one on another).
 * Development: browsers share localhost cookies across ports, so each app needs its own
 * cookie names or signing in to admin (:3002) would clobber the family session (:3000).
 */
import "server-only";
import type { CookiesOptions } from "next-auth";
import type { AppName } from "@repo/lib/roles";

export const isProd = () => process.env.NODE_ENV === "production";

export function cookieName(app: AppName, name: string): string {
  return `${isProd() ? "__Host-" : ""}sos-${app}.${name}`;
}

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
