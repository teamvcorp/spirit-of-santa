/** Pure URL helpers for language switching (unit-tested, no Next imports). */
import { LOCALES, type Locale } from "@repo/lib/locales";

/** Remove a leading locale segment: "/es/wishlist" → "/wishlist", "/es" → "/". */
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if ((LOCALES as readonly string[]).includes(first ?? "")) return "/" + rest.join("/");
  return pathname || "/";
}

/** Same page in another language, always with an explicit prefix ("/en/wishlist"). */
export function switchLocalePath(pathname: string, target: Locale): string {
  const bare = stripLocale(pathname);
  return bare === "/" ? `/${target}` : `/${target}${bare}`;
}
