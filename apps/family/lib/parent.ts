/**
 * Parent-area guards (family app). SERVER-ONLY.
 * Kids use the family app on a parent's signed-in device, so the parent area needs BOTH the
 * login session AND the parent PIN unlock (15 min cookie, @repo/auth/parent-pin).
 * Pages AND Server Actions call these: an action is a public POST endpoint, so a page check
 * alone would not stop a kid (or anyone with the session) from calling it directly.
 */
import "server-only";
import { getLocale } from "next-intl/server";
import { requireRole } from "@repo/auth";
import { hasParentPin, isParentUnlocked } from "@repo/auth/parent-pin";
import { authOptions } from "@/auth";
import { redirect } from "@/i18n/navigation";

/** Signed-in parent (else sign-in / 404). */
export async function requireParent() {
  const user = await requireRole(authOptions, "parent");
  return { id: user.id, familyId: user.familyId };
}

/** Locale-aware redirect for PAGES (route context; Server Actions use localizePath instead). */
export async function goTo(href: string): Promise<never> {
  return redirect({ href, locale: await getLocale() });
}

/**
 * Where to go after the PIN (`?next=`). ONLY these family-app paths are accepted, so the link can
 * never send anyone to another site (no open redirect): /parent, /parent/kids/new,
 * /parent/kids/<id>, /parent/register, /parent/bonus[?kid=<id>], /parent/payup, /kids/<id>, /kids/<id>/deed,
 * /kids/<id>/wishlist/<wishId>/remove.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 120) return null;
  const ok = /^\/(?:parent(?:\/(?:kids\/new|kids\/[a-f0-9]{24}|register|payup|bonus(?:\?kid=[a-f0-9]{24})?))?|kids\/[a-f0-9]{24}(?:\/deed|\/wishlist\/[a-f0-9]{24}\/remove)?)$/.test(raw);
  return ok ? raw : null;
}

/**
 * Parent AND PIN-unlocked (pages). The unlock cookie is checked first (no DB): a valid unlock
 * implies a PIN exists. Only when locked do we ask the DB whether a PIN was ever set.
 * `next` = this page's path: after the PIN the parent comes BACK here (not to the dashboard).
 */
export async function requireUnlockedPage(next?: string) {
  const parent = await requireParent();
  if (await isParentUnlocked(parent)) return parent;
  const target = (await hasParentPin(parent)) ? "/parent/pin" : "/parent/pin/setup";
  const back = safeNext(next);
  return goTo(back ? `${target}?next=${encodeURIComponent(back)}` : target);
}

/** Parent AND PIN-unlocked (Server Actions): null if locked, so the action can say so. */
export async function unlockedParentOrNull() {
  const parent = await requireParent();
  return (await isParentUnlocked(parent)) ? parent : null;
}
