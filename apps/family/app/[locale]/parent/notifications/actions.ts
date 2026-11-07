"use server";
/** Save which emails the parent gets (parent + PIN unlock re-checked here). */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { setNotifyPrefs } from "@repo/families/notifications";
import { NOTIFY_KINDS, type NotifyPrefs } from "@repo/lib/notify";
import { unlockedParentOrNull } from "@/lib/parent";

export type NotifyFormState = {
  status: "idle" | "saved" | "error";
  error?: "locked" | "notFound";
  /** What the parent chose, echoed back on error so the boxes keep their state. */
  values?: NotifyPrefs;
  nonce?: string;
};

// Checkbox = "on" when ticked, absent when not; anything else is treated as not ticked.
const box = z.literal("on").nullable().catch(null).transform((v) => v === "on");
const schema = z.object(Object.fromEntries(NOTIFY_KINDS.map((k) => [k, box])) as Record<(typeof NOTIFY_KINDS)[number], typeof box>);

export async function saveNotifyAction(_prev: NotifyFormState, fd: FormData): Promise<NotifyFormState> {
  const prefs = schema.parse(Object.fromEntries(NOTIFY_KINDS.map((k) => [k, fd.get(k)]))) as NotifyPrefs;
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked", values: prefs, nonce: randomUUID() };
  if (!(await setNotifyPrefs(parent, prefs))) return { status: "error", error: "notFound", values: prefs, nonce: randomUUID() };
  refresh();
  return { status: "saved", nonce: randomUUID() };
}
