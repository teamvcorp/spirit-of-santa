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
 * Parent AND PIN-unlocked (pages). The unlock cookie is checked first (no DB): a valid unlock
 * implies a PIN exists. Only when locked do we ask the DB whether a PIN was ever set.
 */
export async function requireUnlockedPage() {
  const parent = await requireParent();
  if (await isParentUnlocked(parent)) return parent;
  return goTo((await hasParentPin(parent)) ? "/parent/pin" : "/parent/pin/setup");
}

/** Parent AND PIN-unlocked (Server Actions): null if locked, so the action can say so. */
export async function unlockedParentOrNull() {
  const parent = await requireParent();
  return (await isParentUnlocked(parent)) ? parent : null;
}
