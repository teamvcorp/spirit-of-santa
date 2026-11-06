/**
 * Parent-area guards (family app). SERVER-ONLY.
 * Kids use the family app on a parent's signed-in device, so the parent area needs BOTH the
 * login session AND the parent PIN unlock (15 min cookie, @repo/auth/parent-pin).
 * Pages AND Server Actions call these: an action is a public POST endpoint, so a page check
 * alone would not stop a kid (or anyone with the session) from calling it directly.
 */
import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "@repo/auth";
import { hasParentPin, isParentUnlocked } from "@repo/auth/parent-pin";
import { authOptions } from "@/auth";

/** Signed-in parent (else sign-in / 404). */
export async function requireParent() {
  const user = await requireRole(authOptions, "parent");
  return { id: user.id, familyId: user.familyId };
}

/** Parent AND PIN-unlocked (pages): first time → set a PIN; otherwise → enter it. */
export async function requireUnlockedPage() {
  const parent = await requireParent();
  if (!(await hasParentPin(parent))) redirect("/parent/pin/setup");
  if (!(await isParentUnlocked(parent))) redirect("/parent/pin");
  return parent;
}

/** Parent AND PIN-unlocked (Server Actions): null if locked, so the action can say so. */
export async function unlockedParentOrNull() {
  const parent = await requireParent();
  return (await isParentUnlocked(parent)) ? parent : null;
}
