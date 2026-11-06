"use server";
/**
 * MFA setup Server Action (admin app). Uses requireMfaSetupUser, NOT requireRole: this is the
 * one action a restricted (no-MFA-yet) admin session may call. Everything is re-checked in
 * @repo/auth/mfa (admin, active, MFA still off, pending secret, rate limit).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireMfaSetupUser } from "@repo/auth";
import { confirmMfaSetup } from "@repo/auth/mfa";
import { authOptions } from "@/auth";

export type MfaSetupState = {
  status: "idle" | "done" | "error";
  /** invalidCode | expired | rateLimited | notFound → MfaSetup.errors.<code> */
  error?: string;
  /** Shown ONCE, right after MFA is turned on. Never stored in clear anywhere. */
  recoveryCodes?: string[];
  nonce?: string;
};

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "invalidCode") });

export async function confirmMfaAction(_prev: MfaSetupState, fd: FormData): Promise<MfaSetupState> {
  const user = await requireMfaSetupUser(authOptions);
  const parsed = codeSchema.safeParse({ code: typeof fd.get("code") === "string" ? fd.get("code") : "" });
  if (!parsed.success) return { status: "error", error: "invalidCode", nonce: randomUUID() };
  const result = await confirmMfaSetup(user.id, parsed.data.code);
  if (!result.ok) return { status: "error", error: result.error, nonce: randomUUID() };
  // No refresh(): the page would re-render as "already on" and the codes would vanish
  // before the admin saved them. Their session ends anyway (sessionVersion bumped).
  return { status: "done", recoveryCodes: result.recoveryCodes, nonce: randomUUID() };
}
