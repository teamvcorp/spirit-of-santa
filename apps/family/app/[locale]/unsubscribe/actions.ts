"use server";
/** "Stop these emails" button on /unsubscribe (no sign-in: the signed token is the permission). */
import { unsubscribe } from "@repo/families/notifications";

export type UnsubscribeState = { status: "idle" | "done" | "error" };

export async function unsubscribeAction(_prev: UnsubscribeState, fd: FormData): Promise<UnsubscribeState> {
  const kind = await unsubscribe(fd.get("t"));
  return { status: kind ? "done" : "error" };
}
