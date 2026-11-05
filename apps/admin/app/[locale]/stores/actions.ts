"use server";
/**
 * Admin store actions. Each one:
 *  1. requireRole(authOptions, "admin"): a Server Action is a public POST endpoint, so the
 *     role is checked HERE, not just on the page that shows the button.
 *  2. validates input with zod (ids, discount %, reasons),
 *  3. calls @repo/stores/admin (atomic status change + audit log + owner email),
 *  4. refresh() so the page re-renders with the new state.
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@repo/auth";
import { fieldErrors } from "@repo/auth/schemas";
import { approveStore, inviteStore, reinstateStore, rejectStore, setStoreDiscount, suspendStore, type AdminResult } from "@repo/stores/admin";
import { discountPercentSchema, inviteStoreSchema, objectIdSchema, rejectReasonSchema, suspendReasonSchema } from "@repo/stores/schemas";
import { isLocale } from "@repo/lib/locales";
import { authOptions } from "@/auth";
import type { AdminFormState } from "./admin-form-state";

async function currentAdmin() {
  const user = await requireRole(authOptions, "admin");
  return { id: user.id, role: user.role };
}
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const fail = (fieldErrors: Record<string, string>, fd: FormData, keep: string[]): AdminFormState => ({
  status: "error",
  fieldErrors,
  values: Object.fromEntries(keep.map((k) => [k, str(fd, k).slice(0, 500)])),
  nonce: randomUUID(),
});
function finish(r: AdminResult): AdminFormState {
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", storeId: r.storeId, nonce: randomUUID() };
}
function storeIdOf(fd: FormData): string | null {
  const id = objectIdSchema.safeParse(str(fd, "storeId"));
  return id.success ? id.data : null;
}

export async function approveAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const id = storeIdOf(fd);
  const discount = discountPercentSchema.safeParse(str(fd, "discount"));
  if (!id) return { status: "error", error: "notFound" };
  if (!discount.success) return fail({ discount: "invalid" }, fd, ["discount"]);
  return finish(await approveStore(admin, id, discount.data));
}

export async function rejectAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const id = storeIdOf(fd);
  const reason = rejectReasonSchema.safeParse(str(fd, "reason"));
  if (!id) return { status: "error", error: "notFound" };
  if (!reason.success) return fail({ reason: reason.error.issues[0]?.message ?? "invalid" }, fd, ["reason"]);
  return finish(await rejectStore(admin, id, reason.data));
}

export async function suspendAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const id = storeIdOf(fd);
  const reason = suspendReasonSchema.safeParse(str(fd, "reason"));
  if (!id) return { status: "error", error: "notFound" };
  if (!reason.success) return fail({ reason: reason.error.issues[0]?.message ?? "invalid" }, fd, ["reason"]);
  return finish(await suspendStore(admin, id, reason.data));
}

export async function reinstateAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const id = storeIdOf(fd);
  if (!id) return { status: "error", error: "notFound" };
  return finish(await reinstateStore(admin, id));
}

export async function discountAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const id = storeIdOf(fd);
  const discount = discountPercentSchema.safeParse(str(fd, "discount"));
  if (!id) return { status: "error", error: "notFound" };
  if (!discount.success) return fail({ discount: "invalid" }, fd, ["discount"]);
  return finish(await setStoreDiscount(admin, id, discount.data));
}

export async function inviteAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await currentAdmin();
  const keep = ["storeName", "ownerEmail", "category", "discount", "language"];
  const parsed = inviteStoreSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(fieldErrors(parsed.error), fd, keep);
  const language = str(fd, "language");
  const { discount, ...rest } = parsed.data;
  const r = await inviteStore(admin, { ...rest, discountBps: discount }, isLocale(language) ? language : "en");
  if (!r.ok) return { ...fail({}, fd, keep), error: r.error };
  return finish(r);
}