/**
 * next-intl routing config, one per app (the locale cookie name is per app).
 *
 * URL scheme ("as-needed"): English has no prefix (/wishlist), Spanish is /es/wishlist.
 * Detection order on a prefix-less URL: locale cookie → Accept-Language header → English.
 * Docs: docs/vendor/next-intl.md
 */
import { defineRouting } from "next-intl/routing";
import { cookieName, isProd } from "@repo/lib/cookies";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import type { AppName } from "@repo/lib/roles";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function createRouting(app: AppName) {
  return defineRouting({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    localePrefix: "as-needed",
    // A language preference, not an identity: no PII, so a long-lived cookie is fine.
    // Same naming rules as our auth cookies (__Host- in production).
    localeCookie: {
      name: cookieName(app, "locale"),
      sameSite: "lax",
      secure: isProd(),
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    },
  });
}

export type AppRouting = ReturnType<typeof createRouting>;
