"use server";
/**
 * Admin donation actions (Phase 5 slice 2b). requireRole admin (a Server Action is a public POST
 * endpoint) → service (all rules re-checked there: season frozen/closed, fee set, one run at a
 * time, audited) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { retryFailedReceipts, sendPendingReceipts } from "@repo/payments/receipts";
import { runDonationSplit } from "@repo/payments/split";
import { clearSeasonResetAttention } from "@repo/payments/season-end";
import { authOptions } from "@/auth";

export type DonationsFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  /** Split summary or receipt counts for the message. */
  info?: Record<string, number>;
  nonce?: string;
};

const splitForm = z.object({ confirm: z.literal("yes") });

export async function runSplitAction(_prev: DonationsFormState, fd: FormData): Promise<DonationsFormState> {
  const admin = await requireRole(authOptions, "admin");
  // Sharing money is irreversible: the form requires an explicit tick.
  if (!splitForm.safeParse({ confirm: fd.get("confirm") }).success) return { status: "error", error: "confirmRequired", nonce: randomUUID() };
  const r = await runDonationSplit({ trigger: "admin", adminUserId: admin.id });
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", info: { kids: r.kidsCredited, cents: r.totalCents, fee: r.feeCents }, nonce: randomUUID() };
}

export async function retryReceiptsAction(): Promise<DonationsFormState> {
  await requireRole(authOptions, "admin");
  const requeued = await retryFailedReceipts();
  const { sent } = await sendPendingReceipts({ limit: 10 }); // the rest go out on the daily cron
  refresh();
  return { status: "done", info: { requeued, sent }, nonce: randomUUID() };
}

const clearForm = z.object({ confirm: z.literal("yes"), seasonYear: z.coerce.number().int().min(2026).max(2100) });

/** The kids flagged by a season reset have been handled: stop the daily alarm. Audited. */
export async function clearResetAttentionAction(_prev: DonationsFormState, fd: FormData): Promise<DonationsFormState> {
  const admin = await requireRole(authOptions, "admin");
  const parsed = clearForm.safeParse({ confirm: fd.get("confirm"), seasonYear: fd.get("seasonYear") });
  if (!parsed.success) return { status: "error", error: "confirmRequired", nonce: randomUUID() };
  if (!(await clearSeasonResetAttention(admin.id, parsed.data.seasonYear))) return { status: "error", error: "changed", nonce: randomUUID() };
  refresh();
  return { status: "done", nonce: randomUUID() };
}
