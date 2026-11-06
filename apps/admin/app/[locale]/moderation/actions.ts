"use server";
/** Approve / hide "Other" deed text. requireRole admin → zod → @repo/deeds/moderation (audited). */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { reviewDeedText } from "@repo/deeds/moderation";
import { formString } from "@repo/lib/form";
import { authOptions } from "@/auth";

export type ReviewState = { status: "idle" | "done" | "error"; error?: string; nonce?: string };

export async function reviewAction(_prev: ReviewState, fd: FormData): Promise<ReviewState> {
  const admin = await requireRole(authOptions, "admin");
  const parsed = z.object({ id: z.string().min(1), decision: z.enum(["approved", "rejected"]) }).safeParse({ id: formString(fd, "id"), decision: formString(fd, "decision") });
  if (!parsed.success) return { status: "error", error: "notFound", nonce: randomUUID() };
  const r = await reviewDeedText(admin.id, parsed.data.id, parsed.data.decision);
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", nonce: randomUUID() };
}
