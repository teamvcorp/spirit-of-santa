"use server";
/**
 * Admin platform settings (Phase 5 slice 2): donation-pool fee %, charity on tax receipts, and the
 * receipts switch. requireRole admin (a Server Action is a public POST endpoint) → Zod → service
 * (re-validated + audited there) → if receipts are ready, send any that were waiting.
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { sendPendingReceipts } from "@repo/payments/receipts";
import { getPlatformSettings, percentToBps, updatePlatformSettings } from "@repo/payments/settings";
import { authOptions } from "@/auth";

export type SettingsFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  /** Receipts emailed right after saving (they were waiting for the switch / charity details). */
  sent?: number;
  values?: Record<string, string>;
  nonce?: string;
};

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const form = z.object({
  fee: z.string().max(6),
  legalName: z.string().max(120),
  ein: z.string().max(10),
  address: z.string().max(200),
  receipts: z.enum(["on", ""]),
});

export async function saveSettingsAction(_prev: SettingsFormState, fd: FormData): Promise<SettingsFormState> {
  const admin = await requireRole(authOptions, "admin");
  const raw = { fee: str(fd, "fee"), legalName: str(fd, "legalName"), ein: str(fd, "ein"), address: str(fd, "address"), receipts: str(fd, "receipts") };
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.slice(0, 200)]));
  const fail = (error: string): SettingsFormState => ({ status: "error", error, values, nonce: randomUUID() });
  const parsed = form.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const bps = percentToBps(parsed.data.fee);
  if (bps === null) return fail("fee");
  const ein = parsed.data.ein.trim();
  if (ein !== "" && !/^\d{2}-\d{7}$/.test(ein)) return fail("ein");
  const r = await updatePlatformSettings(admin.id, {
    donationFeeBps: bps,
    legalName: parsed.data.legalName.trim(),
    ein,
    address: parsed.data.address.trim(),
    receiptsEnabled: parsed.data.receipts === "on",
  });
  if (!r.ok) return fail(r.error);
  // Receipts waiting for the switch / charity details go out now (the rest on the daily cron).
  const sent = (await getPlatformSettings()).receiptsReady ? (await sendPendingReceipts({ limit: 50 })).sent : 0;
  refresh();
  return { status: "done", sent, nonce: randomUUID() };
}
