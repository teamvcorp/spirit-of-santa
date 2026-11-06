"use server";
/**
 * Admin user actions. Each: requireRole admin (Server Actions are public POST endpoints) →
 * zod → @repo/auth/admin-users (re-checks: not yourself, current status, admin-only MFA reset;
 * change + audit in one transaction) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { reinstateUser, resetUserMfa, signOutEverywhere, suspendUser, unlockUser, type UserAdminResult } from "@repo/auth/admin-users";
import { authOptions } from "@/auth";

export type UserFormState = { status: "idle" | "done" | "error"; error?: string; done?: string; nonce?: string };

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const idSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const actionSchema = z.object({
  userId: idSchema,
  op: z.enum(["suspend", "reinstate", "unlock", "signOut", "resetMfa"]),
  reason: z.string().trim().max(500),
});

/** One action for all buttons: `op` picks the operation (each button is its own small form). */
export async function userAction(_prev: UserFormState, fd: FormData): Promise<UserFormState> {
  const admin = await requireRole(authOptions, "admin");
  const parsed = actionSchema.safeParse({ userId: str(fd, "userId"), op: str(fd, "op"), reason: str(fd, "reason") });
  if (!parsed.success) return { status: "error", error: "notFound", nonce: randomUUID() };
  const { userId, op, reason } = parsed.data;
  if (op === "suspend" && reason.length < 3) return { status: "error", error: "reasonRequired", nonce: randomUUID() };
  let r: UserAdminResult;
  switch (op) {
    case "suspend":
      r = await suspendUser(admin.id, userId, reason);
      break;
    case "reinstate":
      r = await reinstateUser(admin.id, userId);
      break;
    case "unlock":
      r = await unlockUser(admin.id, userId);
      break;
    case "signOut":
      r = await signOutEverywhere(admin.id, userId);
      break;
    case "resetMfa":
      r = await resetUserMfa(admin.id, userId);
      break;
  }
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", done: op, nonce: randomUUID() };
}
