"use server";
/**
 * Store dashboard Server Actions. Public POST endpoints, so each one:
 *  1. requireRole(authOptions, ...): signed in to THIS app with the right role,
 *  2. validates input (zod / file checks),
 *  3. calls @repo/stores/owner, which re-checks from the DB that this user owns the store,
 *  4. refresh() so the page shows the change.
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@repo/auth";
import { emailSchema, fieldErrors, storeDetailsSchema } from "@repo/auth/schemas";
import { isLocale } from "@repo/lib/locales";
import { addStorePhoto, inviteRep, removeRep, removeStorePhoto, updateStoreProfile, type OwnerResult } from "@repo/stores/owner";
import { objectIdSchema } from "@repo/stores/schemas";
import { authOptions } from "@/auth";
import type { DashFormState } from "./form-state";

async function currentOwner() {
  const u = await requireRole(authOptions, "store_owner");
  return { id: u.id, role: u.role, storeId: u.storeId };
}
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const done = (): DashFormState => {
  refresh();
  return { status: "done", nonce: randomUUID() };
};
const failed = (r: Exclude<OwnerResult, { ok: true }>, values?: Record<string, string>): DashFormState => ({
  status: "error",
  error: r.error,
  values,
  nonce: randomUUID(),
});

export async function saveProfileAction(_prev: DashFormState, fd: FormData): Promise<DashFormState> {
  const owner = await currentOwner();
  const values: Record<string, string> = {};
  for (const [k, v] of fd) if (typeof v === "string" && !k.startsWith("$")) values[k] = v.slice(0, 2000);
  const parsed = storeDetailsSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await updateStoreProfile(owner, parsed.data);
  return r.ok ? done() : failed(r, values);
}

export async function addPhotoAction(_prev: DashFormState, fd: FormData): Promise<DashFormState> {
  const owner = await currentOwner();
  const file = fd.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return { status: "error", error: "empty", nonce: randomUUID() };
  const r = await addStorePhoto(owner, file);
  return r.ok ? done() : failed(r);
}

export async function removePhotoAction(_prev: DashFormState, fd: FormData): Promise<DashFormState> {
  const owner = await currentOwner();
  const r = await removeStorePhoto(owner, str(fd, "pathname").slice(0, 200));
  return r.ok ? done() : failed(r);
}

export async function inviteRepAction(_prev: DashFormState, fd: FormData): Promise<DashFormState> {
  const owner = await currentOwner();
  const email = emailSchema.safeParse(str(fd, "email"));
  const values = { email: str(fd, "email").slice(0, 254) };
  if (!email.success) return { status: "error", fieldErrors: { email: "invalid" }, values, nonce: randomUUID() };
  const language = str(fd, "language");
  // This app's own public origin (found by the production E2E: STORE_APP_URL is an admin-app setting).
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const r = await inviteRep(owner, email.data, isLocale(language) ? language : "en", origin);
  return r.ok ? done() : failed(r, values);
}

export async function removeRepAction(_prev: DashFormState, fd: FormData): Promise<DashFormState> {
  const owner = await currentOwner();
  const id = objectIdSchema.safeParse(str(fd, "repId"));
  if (!id.success) return { status: "error", error: "notFound", nonce: randomUUID() };
  const r = await removeRep(owner, id.data);
  return r.ok ? done() : failed(r);
}