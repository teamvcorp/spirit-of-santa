"use server";
/**
 * Record a store payout (paid outside the app). requireRole admin (public POST endpoint) → the
 * service computes the amount from the gifts owed, never from the form, and pays them all at once.
 * The form also echoes the amount the admin saw: if it changed meanwhile (a gift was received in
 * between), we refuse so nobody records a different sum than they actually sent.
 */
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { requireRole } from "@repo/auth";
import { owedByStore, recordPayout } from "@repo/wishlists/payouts";
import { authOptions } from "@/auth";

export type PayoutFormState = { status: "idle" | "error"; error?: string; nonce?: string };

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).slice(0, 400) : "");

export async function recordPayoutAction(_prev: PayoutFormState, fd: FormData): Promise<PayoutFormState> {
  const admin = await requireRole(authOptions, "admin");
  const fail = (error: string): PayoutFormState => ({ status: "error", error, nonce: randomUUID() });
  if (fd.get("confirm") !== "on") return fail("confirm");
  const storeId = str(fd, "storeId");
  const seen = Number(str(fd, "seenCents"));
  const now = (await owedByStore()).find((r) => r.storeId === storeId);
  if (!now || now.owedCents !== seen) return fail("changed");
  const r = await recordPayout(admin.id, storeId, { method: str(fd, "method"), reference: str(fd, "reference"), paidOn: str(fd, "paidOn"), note: str(fd, "note") });
  if (!r.ok) return fail(r.error === "invalid" && r.field ? `field.${r.field}` : r.error);
  // The store's row disappears once nothing is owed, so confirm at PAGE level: ?paid=<payout id>.
  const loc = fd.get("locale");
  redirect(localizePath(`/payouts?paid=${r.payoutId}`, isLocale(loc) ? loc : DEFAULT_LOCALE));
}
