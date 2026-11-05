/**
 * Public origin of the STORE app, for links in emails sent from other apps (admin invites,
 * approval notices). Set STORE_APP_URL in the admin app's env:
 *   local:      http://localhost:3001
 *   production: https://store.spiritofsanta.com
 * In development it defaults to localhost:3001; in production a missing value throws
 * (better a loud error than emails with broken links).
 */
import "server-only";

export function storeAppOrigin(): string {
  const url = process.env.STORE_APP_URL;
  if (url) return new URL(url).origin;
  if (process.env.NODE_ENV === "production") throw new Error("STORE_APP_URL is not set");
  return "http://localhost:3001";
}
