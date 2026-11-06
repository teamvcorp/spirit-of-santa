"use server";
/**
 * Kid adds a gift to their wish list (family device, NO PIN by product decision 2026-11-06).
 * Still requires the signed-in parent session: the engine re-checks EVERYTHING (own registered
 * kid, season open, approved store, stock, duplicates, item cap, ≥1 spare point) inside one
 * transaction, so a forged POST can't do more than the button could.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { addToList, type AddResult } from "@repo/wishlists/engine";
import { requireParent } from "@/lib/parent";

const schema = z.object({ kidId: z.string().regex(OBJECT_ID_RE), itemId: z.string().regex(OBJECT_ID_RE) });

export type AddGiftState = { status: "idle" | "done" | "error"; error?: Extract<AddResult, { ok: false }>["error"] };

export async function addGiftAction(_prev: AddGiftState, fd: FormData): Promise<AddGiftState> {
  const parent = await requireParent();
  const parsed = schema.safeParse({ kidId: fd.get("kidId"), itemId: fd.get("itemId") });
  if (!parsed.success) return { status: "error", error: "notFound" };
  const r = await addToList(parent, parsed.data.kidId, parsed.data.itemId);
  if (!r.ok) return { status: "error", error: r.error };
  refresh(); // re-render the page: points, "already on the list"
  return { status: "done" };
}
