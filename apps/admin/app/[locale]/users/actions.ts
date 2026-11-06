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
import { normalizeObjectId } from "@repo/lib/ids";
import { authOptions } from "@/auth";

export type UserFormState = { status: "idle" | "done" | "error"; error?: string; done?: string; nonce?: string };

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
// Ids are normalised (lower-case) here AND in the service: see @repo/lib/ids.
const actionSchema = z.object({
  userId: z.string().transform((v, ctx) => normalizeObjectId(v) ?? (ctx.addIssue({ code: "custom", message: "notFound" }), z.NEVER)),
  op: z.enum(["suspend", "reinstate", "unlock", "signOut", "resetMfa"]),
  reason: z.string().trim().max(500, "reasonTooLong"),
});

/** One action for all buttons: `op` picks the operation (each button is its own small form). */
export async function userAction(_prev: UserFormState, fd: FormData): Promise<UserFormState> {
  const admin = await requireRole(authOptions, "admin");
  const parsed = actionSchema.safeParse({ userId: str(fd, "userId"), op: str(fd, "op"), reason: str(fd, "reason") });
  if (!parsed.success) {
    // Say what was wrong: a too-long reason isn't "account not found" (review 2026-11-05).
    const tooLong = parsed.error.issues.some((i) => i.message === "reasonTooLong");
    return { status: "error", error: tooLong ? "reasonTooLong" : "notFound", nonce: randomUUID() };
  }
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
