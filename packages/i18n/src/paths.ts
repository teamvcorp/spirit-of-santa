/** Pure URL helpers for language switching (unit-tested, no Next imports). */
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@repo/lib/locales";

/** Remove a leading locale segment: "/es/wishlist" → "/wishlist", "/es" → "/". */
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if ((LOCALES as readonly string[]).includes(first ?? "")) return "/" + rest.join("/");
  return pathname || "/";
}

/**
 * A path in a given language using our "as-needed" URL scheme: English has no prefix.
 * For links built outside the app's next-intl <Link> (e.g. in shared packages).
 *   localizePath("/signin", "es") → "/es/signin";  localizePath("/signin", "en") → "/signin"
 */
export function localizePath(path: string, locale: Locale): string {
  const bare = stripLocale(path);
  if (locale === DEFAULT_LOCALE) return bare;
  return bare === "/" ? `/${locale}` : `/${locale}${bare}`;
}

/** Same page in another language, always with an explicit prefix ("/en/wishlist"). */
export function switchLocalePath(pathname: string, target: Locale): string {
  const bare = stripLocale(pathname);
  return bare === "/" ? `/${target}` : `/${target}${bare}`;
}
