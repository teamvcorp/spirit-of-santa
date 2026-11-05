/**
 * Cookie naming shared by auth (session cookies) and i18n (locale cookie). Client-safe:
 * it only builds strings, so the proxy and edge code can use it too.
 *
 * Production: `__Host-` prefix. Browsers then REQUIRE Secure, Path=/ and NO Domain
 * attribute, so a family cookie can never be sent to admin.spiritofsanta.com (and a
 * compromised subdomain can't plant one on another).
 * Development: browsers share localhost cookies across ports, so each app needs its own
 * cookie names or signing in to admin (:3002) would clobber the family session (:3000).
 */
import type { AppName } from "./roles.ts";

export const isProd = () => process.env.NODE_ENV === "production";

export function cookieName(app: AppName, name: string): string {
  return `${isProd() ? "__Host-" : ""}sos-${app}.${name}`;
}
