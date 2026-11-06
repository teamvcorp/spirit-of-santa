"use server";
/**
 * Admin platform settings (Phase 5 slice 2): donation-pool fee %, charity on tax receipts, the
 * receipts switch and the day receipts start covering. requireRole admin (a Server Action is a
 * public POST endpoint) → service (the ONE place the rules live: Zod + audit) → send a small
 * batch of waiting receipts (the rest go out on the daily cron).
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@repo/auth";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { percentToBps, updatePlatformSettings } from "@repo/payments/settings";
import { authOptions } from "@/auth";

export type SettingsFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  /** Receipts emailed right after saving (they were waiting for the switch / charity details). */
  sent?: number;
  values?: Record<string, string>;
  nonce?: string;
};

const FIELDS = ["fee", "legalName", "ein", "address", "receipts", "fromDay", "shippingAddress"] as const;
// Capped echo copies (the service's Zod schema is the real length check).
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).slice(0, 400) : "");

export async function saveSettingsAction(_prev: SettingsFormState, fd: FormData): Promise<SettingsFormState> {
  const admin = await requireRole(authOptions, "admin");
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(fd, k)])) as Record<(typeof FIELDS)[number], string>;
  const fail = (error: string): SettingsFormState => ({ status: "error", error, values, nonce: randomUUID() });
  const bps = percentToBps(values.fee);
  if (bps === null) return fail("fee");
  const r = await updatePlatformSettings(admin.id, {
    donationFeeBps: bps,
    legalName: values.legalName.trim(),
    ein: values.ein.trim(),
    address: values.address.trim(),
    receiptsEnabled: values.receipts === "on",
    receiptsFromDay: values.fromDay.trim(),
    shippingAddress: values.shippingAddress,
  });
  if (!r.ok) return fail(r.error);
  // A SMALL batch now (keeps Save fast); sendPendingReceipts checks the settings itself.
  const { sent } = await sendPendingReceipts({ limit: 10 });
  refresh();
  return { status: "done", sent, nonce: randomUUID() };
}
