"use server";
/** "Stop these emails" button on /unsubscribe (no sign-in: the signed token is the permission). */
import { unsubscribe, unsubscribeTokenSchema } from "@repo/families/notifications";

export type UnsubscribeState = { status: "idle" | "done" | "error" };

export async function unsubscribeAction(_prev: UnsubscribeState, fd: FormData): Promise<UnsubscribeState> {
  const t = unsubscribeTokenSchema.safeParse(fd.get("t"));
  const kind = t.success ? await unsubscribe(t.data) : null;
  return { status: kind ? "done" : "error" };
}
