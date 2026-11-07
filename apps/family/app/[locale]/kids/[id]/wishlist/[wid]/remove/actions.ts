"use server";
/**
 * Parent removes a gift from a kid's list (PIN unlock re-checked HERE: an action is a public
 * POST endpoint, so the page's check alone wouldn't stop a direct call). The engine checks
 * family ownership, the season, that the gift is still collecting ("active": fully funded = secured)
 * and returns the points.
 */
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { removeFromList } from "@repo/wishlists/engine";
import { unlockedParentOrNull } from "@/lib/parent";

const schema = z.object({ kidId: z.string().regex(OBJECT_ID_RE), wishId: z.string().regex(OBJECT_ID_RE) });

export type RemoveGiftState = { status: "idle" | "error"; error?: "locked" | "seasonNotOpen" | "notFound" | "pinLocked"; nonce?: string };

export async function removeGiftAction(_prev: RemoveGiftState, fd: FormData): Promise<RemoveGiftState> {
  const fail = (error: RemoveGiftState["error"]): RemoveGiftState => ({ status: "error", error, nonce: randomUUID() });
  const parent = await unlockedParentOrNull();
  if (!parent) return fail("pinLocked");
  const parsed = schema.safeParse({ kidId: fd.get("kidId"), wishId: fd.get("wishId") });
  if (!parsed.success) return fail("notFound");
  const r = await removeFromList(parent, parsed.data.wishId);
  if (!r.ok) return fail(r.error);
  const raw = fd.get("locale");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  redirect(localizePath(`/kids/${r.kidId}#wishlist`, locale)); // the engine's kid, not the form's
}
