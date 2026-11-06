/**
 * Public origins of OTHER apps, for links in emails sent from a different app.
 *
 * STORE_APP_URL (admin + family projects): store invites/approvals, the daily store-orders email.
 *   local: http://localhost:3001 · production: https://store.spiritofsanta.com
 * FAMILY_APP_URL (admin + family projects): the parent's "gift on its way" email (Phase 6 slice 3b).
 *   local: http://localhost:3000 · production: https://www.spiritofsanta.com (the address the site
 *   is really served from: spiritofsanta.com redirects to www)
 *
 * In development they default to localhost; in production a missing value throws (better a loud
 * error than emails with broken links).
 */
import "server-only";

function origin(name: "STORE_APP_URL" | "FAMILY_APP_URL", devDefault: string): string {
  const url = process.env[name];
  if (url) return new URL(url).origin;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is not set`);
  return devDefault;
}

export const storeAppOrigin = (): string => origin("STORE_APP_URL", "http://localhost:3001");
export const familyAppOrigin = (): string => origin("FAMILY_APP_URL", "http://localhost:3000");
