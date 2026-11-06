/**
 * Server-side halves of the account forms. SERVER-ONLY. Each app wraps these in a tiny
 * "use server" file that names the app, e.g. apps/store/app/[locale]/account-actions.ts:
 *
 *   "use server";
 *   export async function forgotPasswordAction(prev: FormState, fd: FormData) {
 *     return forgotPassword("store", prev, fd);
 *   }
 *
 * Server Actions are public POST endpoints: everything is re-validated here. Next checks
 * the Origin header against the host for every action (built-in CSRF protection).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import type { AppName } from "@repo/lib/roles";
import {
  acceptRepInvite,
  acceptStoreInvite,
  registerParent,
  registerStoreOwner,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
  type FlowContext,
} from "./account-flows.ts";
import { acceptInviteSchema, acceptRepInviteSchema, emailSchema, fieldErrors, newPasswordSchema, parentRegistrationSchema, storeRegistrationSchema } from "./schemas.ts";
import type { FormState } from "./form-state.ts";

async function context(fd: FormData): Promise<FlowContext> {
  const raw = fd.get("locale");
  // The form tells us its language (Server Actions don't get route params). Only affects
  // the email's language and link prefix, so a spoofed value is harmless.
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const appOrigin = process.env.NEXTAUTH_URL;
  if (!appOrigin) throw new Error("NEXTAUTH_URL is not set"); // links need this app's public origin
  return { headers: await headers(), locale, appOrigin };
}

/**
 * Pad a response to at least ms: an email that exists (send an email, ~0.5 s) and one that
 * doesn't (nothing to send) then take the same time, so timing can't reveal accounts.
 */
const MIN_RESPONSE_MS = 1500;
async function atLeast<T>(work: Promise<T>, ms = MIN_RESPONSE_MS): Promise<T> {
  const [result] = await Promise.all([work, new Promise((r) => setTimeout(r, ms))]);
  return result;
}

/** What the user typed, for re-filling the form after an error. NEVER secrets (password). */
const SECRET_FIELDS = new Set(["password", "currentPassword", "pin"]);
function echoValues(fd: FormData, max: number): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of fd) if (typeof v === "string" && !SECRET_FIELDS.has(k) && !k.startsWith("$")) values[k] = v.slice(0, max);
  return values;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** Error result that keeps the typed email (form re-mounts with it, see FormState.nonce). */
const emailError = (fd: FormData, extra: Partial<FormState>): FormState => ({
  status: "error",
  values: { email: str(fd, "email").slice(0, 254) },
  nonce: randomUUID(),
  ...extra,
});

export async function forgotPassword(app: AppName, _prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(str(fd, "email"));
  if (!email.success) return emailError(fd, { fieldErrors: { email: "invalid" } });
  const r = await atLeast(requestPasswordReset(email.data, app, await context(fd)));
  return r.ok ? { status: "sent" } : emailError(fd, { error: r.error });
}

export async function resendVerificationEmail(app: AppName, _prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(str(fd, "email"));
  if (!email.success) return emailError(fd, { fieldErrors: { email: "invalid" } });
  const r = await atLeast(resendVerification(email.data, await context(fd), app));
  return r.ok ? { status: "sent" } : emailError(fd, { error: r.error });
}

export async function resetPasswordWithToken(_prev: FormState, fd: FormData): Promise<FormState> {
  const password = newPasswordSchema.safeParse(str(fd, "password"));
  if (!password.success) return { status: "error", fieldErrors: { password: password.error.issues[0]?.message ?? "invalid" } };
  const r = await resetPassword(str(fd, "token"), password.data);
  return r.ok ? { status: "done" } : { status: "error", error: r.error };
}

export async function confirmEmailWithToken(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await verifyEmail(str(fd, "token"));
  return r.ok ? { status: "done" } : { status: "error", error: r.error };
}

export async function registerStore(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = storeRegistrationSchema.safeParse(Object.fromEntries(fd));
  // Echo back what the user typed (never the password) so a failed submit doesn't wipe it.
  const values = echoValues(fd, 2000);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await atLeast(registerStoreOwner(parsed.data, await context(fd)));
  return r.ok ? { status: "sent" } : { status: "error", error: r.error, values, nonce: randomUUID() };
}

/** Parent sign-up (family app). Echoes what was typed (never the password) on error. */
export async function registerParentForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = parentRegistrationSchema.safeParse(Object.fromEntries(fd));
  const values = echoValues(fd, 500);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await atLeast(registerParent(parsed.data, await context(fd)));
  return r.ok ? { status: "sent" } : { status: "error", error: r.error, values, nonce: randomUUID() };
}

export async function acceptInvite(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = acceptInviteSchema.safeParse(Object.fromEntries(fd));
  const values = { ownerName: str(fd, "ownerName").slice(0, 100), agree: str(fd, "agree") };
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await acceptStoreInvite(parsed.data, await context(fd));
  return r.ok ? { status: "done" } : { status: "error", error: r.error, values, nonce: randomUUID() };
}
export async function acceptRepInviteForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = acceptRepInviteSchema.safeParse(Object.fromEntries(fd));
  const values = { name: str(fd, "name").slice(0, 100) };
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const r = await acceptRepInvite(parsed.data, await context(fd));
  return r.ok ? { status: "done" } : { status: "error", error: r.error, values, nonce: randomUUID() };
}