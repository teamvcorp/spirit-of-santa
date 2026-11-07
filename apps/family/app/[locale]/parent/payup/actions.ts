"use server";
/**
 * Start a pay-up (parent + PIN unlock re-checked here: an action is a public POST endpoint).
 * The browser only sends WHICH gift; the amount is computed by @repo/families/payup from the DB.
 */
import { z } from "zod";
import { startPayUp, type PayUpStart } from "@repo/families/payup";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import { unlockedParentOrNull } from "@/lib/parent";

export type PayUpState = { status: "idle" } | PayUpStart | { ok: false; error: "locked" };

const schema = z.object({ wishId: z.string().regex(OBJECT_ID_RE), locale: z.enum(LOCALES).catch(DEFAULT_LOCALE) });

export async function payUpAction(_prev: PayUpState, fd: FormData): Promise<PayUpState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { ok: false, error: "locked" };
  const parsed = schema.safeParse({ wishId: fd.get("wishId"), locale: fd.get("locale") });
  if (!parsed.success) return { ok: false, error: "notFound" };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  return startPayUp(parent, parsed.data.wishId, origin, (p) => localizePath(p, parsed.data.locale));
}
