"use server";
/** Save which emails the parent gets (parent + PIN unlock re-checked here). */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { NOTIFY_KINDS, setNotifyPrefs, type NotifyPrefs } from "@repo/families/notifications";
import { unlockedParentOrNull } from "@/lib/parent";

export type NotifyFormState = { status: "idle" | "saved" | "error"; error?: "locked" | "notFound"; nonce?: string };

export async function saveNotifyAction(_prev: NotifyFormState, fd: FormData): Promise<NotifyFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked", nonce: randomUUID() };
  // Checkboxes: present + "on" = ON, anything else = OFF (no other input is read).
  const prefs = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, fd.get(k) === "on"])) as NotifyPrefs;
  if (!(await setNotifyPrefs(parent, prefs))) return { status: "error", error: "notFound", nonce: randomUUID() };
  refresh();
  return { status: "saved", nonce: randomUUID() };
}
