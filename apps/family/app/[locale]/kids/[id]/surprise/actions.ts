"use server";
/**
 * Surprise gifts (owner 2026-11-08). Both actions re-check the PARENT PIN here: a Server Action is a public POST
 * endpoint, so the page's own PIN check isn't enough. The browser only names a child and a gift; every rule
 * (own registered child, season open, approved store, stock, duplicates, gift cap) is checked by the engine, and
 * the price of "Fund it now" is computed from the database by startPayUp.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { startPayUp } from "@repo/families/payup";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import { addSurprise, type AddResult } from "@repo/wishlists/engine";
import { unlockedParentOrNull } from "@/lib/parent";
import type { PayUpState } from "../../../parent/payup/actions";

const addSchema = z.object({ kidId: z.string().regex(OBJECT_ID_RE), itemId: z.string().regex(OBJECT_ID_RE) });

export type AddSurpriseState = { status: "idle" | "done" | "error"; error?: Extract<AddResult, { ok: false }>["error"] | "locked" };

export async function addSurpriseAction(_prev: AddSurpriseState, fd: FormData): Promise<AddSurpriseState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked" };
  const parsed = addSchema.safeParse({ kidId: fd.get("kidId"), itemId: fd.get("itemId") });
  if (!parsed.success) return { status: "error", error: "notFound" };
  const r = await addSurprise(parent, parsed.data.kidId, parsed.data.itemId);
  if (!r.ok) return { status: "error", error: r.error };
  refresh();
  return { status: "done" };
}

const fundSchema = z.object({ wishId: z.string().regex(OBJECT_ID_RE), locale: z.enum(LOCALES).catch(DEFAULT_LOCALE) });

/** "Fund it now": the same pay-up checkout ($1.50 per Christmas Magic), back to this child's surprise page. */
export async function fundSurpriseAction(_prev: PayUpState, fd: FormData): Promise<PayUpState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { ok: false, error: "locked" };
  const parsed = fundSchema.safeParse({ wishId: fd.get("wishId"), locale: fd.get("locale") });
  if (!parsed.success) return { ok: false, error: "notFound" };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  // Back to THE GIFT'S child (kid id from the database inside startPayUp); the return page re-checks the family.
  return startPayUp(parent, parsed.data.wishId, origin, (p) => localizePath(p, parsed.data.locale), (kidId) => `/kids/${kidId}/surprise/return`);
}
