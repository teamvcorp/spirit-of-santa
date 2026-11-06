"use server";
/** "Make a new donation link" (parent + PIN unlock re-checked here). */
import { refresh } from "next/cache";
import { resetDonationLink } from "@repo/deeds/donate";
import { formString } from "@repo/lib/form";
import { unlockedParentOrNull } from "@/lib/parent";

export type LinkState = { status: "idle" | "done" | "error"; error?: string };

export async function resetLinkAction(_prev: LinkState, fd: FormData): Promise<LinkState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked" };
  const r = await resetDonationLink(parent, formString(fd, "kidId"));
  if (!r.ok) return { status: "error", error: "notFound" };
  refresh();
  return { status: "done" };
}
