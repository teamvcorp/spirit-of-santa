"use server";
/**
 * Admin donation actions (Phase 5 slice 2b). requireRole admin (a Server Action is a public POST
 * endpoint) → service (all rules re-checked there: season frozen/closed, fee set, one run at a
 * time, audited) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@repo/auth";
import { retryFailedReceipts, sendPendingReceipts } from "@repo/payments/receipts";
import { runDonationSplit } from "@repo/payments/split";
import { authOptions } from "@/auth";

export type DonationsFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  /** Split summary or receipt counts for the message. */
  info?: Record<string, number>;
  nonce?: string;
};

export async function runSplitAction(_prev: DonationsFormState, fd: FormData): Promise<DonationsFormState> {
  const admin = await requireRole(authOptions, "admin");
  // Sharing money is irreversible: the form requires an explicit tick.
  if (fd.get("confirm") !== "yes") return { status: "error", error: "confirmRequired", nonce: randomUUID() };
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
