"use server";
/**
 * Parent-area Server Actions. Each: requireParent (session) → PIN unlock re-checked HERE for
 * every change → zod → @repo/families/kids (family scoping, limits, audit) → refresh/redirect.
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { setParentPinWithPassword, unlockParentDashboard, lockParentDashboard } from "@repo/auth/parent-pin";
import { fieldErrors } from "@repo/auth/schemas";
import { addKid, deleteKid, updateKid } from "@repo/families/kids";
import { kidSchema } from "@repo/families/schemas";
import { redirect } from "next/navigation";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { requireParent, unlockedParentOrNull } from "@/lib/parent";

export type ParentFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
};

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const err = (error: string, values?: Record<string, string>): ParentFormState => ({ status: "error", error, values, nonce: randomUUID() });
/**
 * Redirect within the family app in the form's language. Server Actions can't read the locale
 * (next/root-params / getLocale() throw there), so every form sends a hidden "locale" field;
 * it only picks the URL prefix, so a spoofed value is harmless.
 */
const go = (href: string, fd: FormData): never => {
  const raw = fd.get("locale");
  redirect(localizePath(href, isLocale(raw) ? raw : DEFAULT_LOCALE));
};

/** First PIN or a new one: needs the account password (see setParentPinWithPassword). */
export async function setPinAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await requireParent();
  const pin = str(fd, "pin");
  if (pin !== str(fd, "pinConfirm")) return { status: "error", fieldErrors: { pinConfirm: "pinMismatch" }, nonce: randomUUID() };
  const r = await setParentPinWithPassword(parent, str(fd, "password"), pin);
  if (!r.ok) return err(r.error);
  return go("/parent", fd);
}

export async function unlockAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await requireParent();
  // Same answer for wrong PIN and lockout (the lockout is what makes guessing impractical).
  if (!(await unlockParentDashboard(parent, str(fd, "pin")))) return err("wrongPin");
  return go("/parent", fd);
}

export async function lockAction(fd: FormData): Promise<void> {
  await requireParent();
  await lockParentDashboard();
  go("/", fd);
}

const KID_FIELDS = ["firstName", "birthYear", "displayName"] as const;

/** Add (no id) or edit a kid. */
export async function saveKidAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  const values = Object.fromEntries(KID_FIELDS.map((k) => [k, str(fd, k).slice(0, 60)]));
  if (!parent) return err("locked", values);
  const parsed = kidSchema().safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const id = str(fd, "id");
  const r = id ? await updateKid(parent, id, parsed.data) : await addKid(parent, parsed.data);
  if (!r.ok) return err(r.error, values);
  return go("/parent", fd);
}

export async function deleteKidAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return err("locked");
  if (str(fd, "confirm") !== "yes") return err("confirmRequired");
  const r = await deleteKid(parent, str(fd, "id"));
  if (!r.ok) return err(r.error);
  refresh();
  return { status: "done", nonce: randomUUID() };
}
