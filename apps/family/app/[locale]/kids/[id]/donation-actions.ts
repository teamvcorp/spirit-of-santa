"use server";
/** "Make a new donation link" (parent + PIN unlock re-checked here). */
import { refresh } from "next/cache";
import { resetDonationLink } from "@repo/deeds/donate";
import { z } from "zod";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { unlockedParentOrNull } from "@/lib/parent";

const schema = z.object({ kidId: z.string().regex(OBJECT_ID_RE) });

export type LinkState = { status: "idle" | "done" | "error"; error?: string };

export async function resetLinkAction(_prev: LinkState, fd: FormData): Promise<LinkState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked" };
  const parsed = schema.safeParse({ kidId: fd.get("kidId") });
  if (!parsed.success) return { status: "error", error: "notFound" };
  const r = await resetDonationLink(parent, parsed.data.kidId);
  if (!r.ok) return { status: "error", error: "notFound" };
  refresh();
  return { status: "done" };
}
