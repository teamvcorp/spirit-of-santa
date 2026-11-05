/**
 * Proxy (Next 16's name for middleware). Language detection only; NOT an auth check.
 * Shared logic: packages/i18n/src/proxy.ts. Notes: docs/vendor/next-intl.md
 */
import { createI18nProxy } from "@repo/i18n/proxy";
import { routing } from "./i18n/routing";

export default createI18nProxy(routing);

export const config = {
  // Must be a literal (Next reads it at build time). Skips /api (NextAuth, webhooks),
  // Next internals, Vercel internals and any path with a dot (files like favicon.ico).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
