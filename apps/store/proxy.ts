/**
 * Proxy (Next 16's name for middleware). Language detection only; NOT an auth check.
 * Shared logic: packages/i18n/src/proxy.ts. Notes: docs/vendor/next-intl.md
 */
import { createI18nProxy } from "@repo/i18n/proxy";
import { routing } from "./i18n/routing";

export default createI18nProxy(routing);

export const config = {
  // Must be a literal (Next reads it at build time). Skips /api (NextAuth, webhooks),
  // Next internals, Vercel internals, generated icons (/icon/<size>, /apple-icon: no dot in
  // the URL, so without this they would get a locale prefix and 404) and any path with a dot
  // (files like manifest.webmanifest).
  matcher: "/((?!api|_next|_vercel|icon/|apple-icon|.*\\..*).*)",
};
