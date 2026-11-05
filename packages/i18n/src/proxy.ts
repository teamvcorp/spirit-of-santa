/**
 * Locale proxy (Next 16 renamed middleware → proxy). It only picks the language and
 * redirects/rewrites the URL; it is NOT an auth layer (auth is checked where data is read).
 *
 * Usage in apps/<app>/proxy.ts (the `config` matcher must be a literal in that file,
 * because Next reads it statically):
 *   export default createI18nProxy(routing);
 *   export const config = { matcher: "/((?!api|_next|_vercel|.*\\..*).*)" };
 */
import createMiddleware from "next-intl/middleware";
import type { AppRouting } from "./routing.ts";

export function createI18nProxy(routing: AppRouting) {
  return createMiddleware(routing);
}
