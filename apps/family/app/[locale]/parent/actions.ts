"use server";
/**
 * Parent-area Server Actions. Each: requireParent (session) → PIN unlock re-checked HERE for
 * every change → zod → @repo/families/kids (family scoping, limits, audit) → refresh/redirect.
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { setParentPinWithPassword, unlockParentDashboard, lockParentDashboard } from "@repo/auth/parent-pin";
import { fieldErrors } from "@repo/auth/schemas";
import { addKid, getKid, updateKid } from "@repo/families/kids";
import { eraseFamily, eraseKid } from "@repo/families/erase";
import { endSessionCookies } from "@repo/auth/end-session";
import { verifyAccountPassword } from "@repo/auth/reauth";
import { ownFamilyId } from "@repo/auth/family-owner";
import { familyAliasSchema, kidSchema, voteSchema } from "@repo/families/schemas";
import { setFamilyAlias } from "@repo/families/settings";
import { castVote } from "@repo/families/votes";
import { redirect } from "next/navigation";
import { localizePath } from "@repo/i18n/paths";
import { formString } from "@repo/lib/form";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { requireParent, safeNext, unlockedParentOrNull } from "@/lib/parent";

export type ParentFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
  /** Set when the PIN lock state changed: the form does a FULL page load to this path (see reloadTo). */
  to?: string;
};

const str = formString;
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

/**
 * After the PIN LOCK STATE changes (set PIN / unlock / lock) we don't use a router redirect: the
 * browser's router remembers pages from before the change (e.g. "/parent → /parent/pin" while
 * locked, which made the FIRST correct PIN look like it failed; or an UNLOCKED parent page after
 * locking). Instead the action returns the path and the form does a full page load (useFullReload),
 * which throws all of that away. Bug found 2026-11-06 clicking through on the dev server.
 */
const reloadTo = (href: string, fd: FormData): ParentFormState => {
  const raw = fd.get("locale");
  return { status: "done", to: localizePath(href, isLocale(raw) ? raw : DEFAULT_LOCALE) };
};

/** First PIN or a new one: needs the account password (see setParentPinWithPassword). */
export async function setPinAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await requireParent();
  const pin = str(fd, "pin");
  if (pin !== str(fd, "pinConfirm")) return { status: "error", fieldErrors: { pinConfirm: "pinMismatch" }, nonce: randomUUID() };
  const r = await setParentPinWithPassword(parent, str(fd, "password"), pin);
  if (!r.ok) return err(r.error);
  // Back to the page that asked for the PIN (only known family-app paths), else the dashboard.
  return reloadTo(safeNext(fd.get("next")) ?? "/parent", fd);
}

export async function unlockAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await requireParent();
  // Same answer for wrong PIN and lockout (the lockout is what makes guessing impractical).
  if (!(await unlockParentDashboard(parent, str(fd, "pin")))) return err("wrongPin");
  return reloadTo(safeNext(fd.get("next")) ?? "/parent", fd);
}

/**
 * Lock: a plain redirect home. (A returned path + full reload does NOT work here: Next re-renders
 * the current page after an action that changes cookies, and the now-locked /parent redirects to
 * the PIN page first.) The E2E checks no unlocked page is served from the browser cache afterwards.
 */
export async function lockAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  await requireParent();
  await lockParentDashboard();
  return go("/", fd);
}

const KID_FIELDS = ["firstName", "birthYear", "displayName", "itemCap"] as const;

/** Add (no id) or edit a kid. */
export async function saveKidAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  const values = Object.fromEntries(KID_FIELDS.map((k) => [k, str(fd, k).slice(0, 60)]));
  if (!parent) return err("locked", values);
  const id = str(fd, "id");
  // Editing: the kid's current birth year is always accepted (see kidSchema keepYear).
  const current = id ? await getKid(parent, id) : null;
  if (id && !current) return err("notFound", values);
  const parsed = kidSchema(new Date(), current?.birthYear).safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = id ? await updateKid(parent, id, parsed.data) : await addKid(parent, parsed.data);
  if (!r.ok) return err(r.error, values);
  return go("/parent", fd);
}

export async function deleteKidAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return err("locked");
  if (str(fd, "confirm") !== "yes") return err("confirmRequired");
  const r = await eraseKid(parent, str(fd, "id"));
  if (!r.ok) return err(r.error);
  refresh();
  return { status: "done", nonce: randomUUID() };
}

/** Today's Naughty/Nice vote for one kid (PIN re-checked here). */
export async function voteAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return err("locked");
  const parsed = voteSchema.safeParse({ kidId: str(fd, "kidId"), vote: str(fd, "vote") });
  if (!parsed.success) return err("notFound");
  const r = await castVote(parent, parsed.data.kidId, parsed.data.vote);
  if (!r.ok) return err(r.error);
  refresh();
  return { status: "done", nonce: randomUUID() };
}

/** Family nickname for public QR pages (PIN re-checked here). */
export async function aliasAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const values = { alias: str(fd, "alias").slice(0, 60), show: str(fd, "show") === "on" ? "on" : "off" };
  const parent = await unlockedParentOrNull();
  if (!parent) return err("locked", values);
  const parsed = familyAliasSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await setFamilyAlias(parent, parsed.data.alias, parsed.data.show === "on");
  if (!r.ok) return err("noFamily", values);
  refresh();
  return { status: "done", nonce: randomUUID() };
}

/** Words that confirm "delete my family account" (either language, any capitals). */
const DELETE_WORDS = new Set(["DELETE", "BORRAR"]);

/**
 * Delete the WHOLE family account (Phase 8, COPPA deletion right). Three checks, all on the server:
 * PIN unlocked, the typed confirmation word, and the account password (sign-in lockout, reauth.ts).
 * Then @repo/families/erase does the deletion (and emails the parent a confirmation); this browser is
 * signed out, then REDIRECTED (server side) to the public goodbye page. Not reloadTo: changing cookies in an action
 * makes Next re-render the CURRENT page, which (account gone) would bounce to sign-in before the client could
 * follow a returned path. A server redirect renders the goodbye page instead (found by browser-family-erase E2E).
 */
export async function deleteAccountAction(_prev: ParentFormState, fd: FormData): Promise<ParentFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return err("locked");
  // Already deleted or closing (e.g. a second click after the first one went through): just show the goodbye page.
  if (!(await ownFamilyId(parent))) return go("/account-deleted", fd);
  if (!DELETE_WORDS.has(str(fd, "confirm").trim().toUpperCase())) return err("confirmWord");
  if (!(await verifyAccountPassword(parent.id, str(fd, "password"), { role: "parent" }))) return err("wrongPassword");
  let r;
  try {
    r = await eraseFamily(parent, { mode: str(fd, "mode") === "now" ? "now" : "deliverFirst" });
  } catch (e) {
    // Part-way failure (e.g. a child added on another device meanwhile, a database blip): what was finished
    // stays finished, nothing is half-done per child (one transaction each). Trying again continues.
    console.error("[family] account deletion stopped part-way:", e instanceof Error ? e.message : "unknown");
    return err("failed");
  }
  if (!r.ok) return err("notFound");
  await lockParentDashboard();
  await endSessionCookies("family");
  return go(r.pending ? "/account-deleted/closing" : "/account-deleted", fd);
}
