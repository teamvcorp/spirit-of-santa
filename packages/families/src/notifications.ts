/**
 * Parent email notification preferences + one-click unsubscribe (Phase 7). SERVER-ONLY.
 * User decisions 2026-11-06: EMAIL only, PARENTS only; kinds: "magic" (points received),
 * "deeds" (a good deed was thanked), "reminders" (Dec 1 cutoff, pay-up deadline). All ON by
 * default; each can be switched off in the parent area or by the link in every such email.
 *
 * Unsubscribe links work WITHOUT signing in (that's what mail providers and the law expect), so
 * they carry a signed token: "<familyId>.<kind>.<signature>", HMAC-SHA256 under a key DERIVED from
 * NEXTAUTH_SECRET with its own HKDF label (the session key itself is never reused). It can only
 * ever switch ONE kind of email OFF for ONE family: nothing to steal, nothing to switch on.
 * Tokens don't expire on purpose (an unsubscribe link in an old email must still work).
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sessionPurposeKey } from "@repo/auth/purpose-key";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { AuditLog, connectDb, Family, withTransaction } from "@repo/db";
import type { OptOutLinks } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import type { Locale } from "@repo/lib/locales";
import { familyAppOrigin } from "@repo/stores/urls";

import { NOTIFY_KINDS, type NotifyKind, type NotifyPrefs } from "@repo/lib/notify";
export { NOTIFY_KINDS, type NotifyKind, type NotifyPrefs };

/**
 * What an unsubscribe link switches off: one kind, or "digest" = the daily summary, which carries
 * BOTH magic and deeds news (a link that stopped only one would leave the email coming).
 */
export const UNSUB_SCOPES = [...NOTIFY_KINDS, "digest"] as const;
export type UnsubScope = (typeof UNSUB_SCOPES)[number];
const SCOPE_KINDS: Record<UnsubScope, NotifyKind[]> = { magic: ["magic"], deeds: ["deeds"], reminders: ["reminders"], digest: ["magic", "deeds"] };

const isScope = (v: unknown): v is UnsubScope => typeof v === "string" && (UNSUB_SCOPES as readonly string[]).includes(v);
/** Missing = never chosen = ON (the default). */
export const prefsOf = (notify?: Partial<Record<NotifyKind, boolean | null>> | null): NotifyPrefs =>
  Object.fromEntries(NOTIFY_KINDS.map((k) => [k, notify?.[k] !== false])) as NotifyPrefs;

export async function getNotifyPrefs(parent: Parent): Promise<NotifyPrefs | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  const f = await Family.findById(fid).select("notify").lean<{ notify?: Partial<Record<NotifyKind, boolean>> }>();
  return f ? prefsOf(f.notify) : null;
}

/** Parent area (PIN). Audited (which kinds are on, nothing else). */
export async function setNotifyPrefs(parent: Parent, prefs: NotifyPrefs): Promise<boolean> {
  const fid = await ownFamilyId(parent);
  if (!fid) return false;
  await withTransaction(async (session) => {
    await Family.updateOne({ _id: fid }, { $set: Object.fromEntries(NOTIFY_KINDS.map((k) => [`notify.${k}`, prefs[k] === true])) }, { session });
    await AuditLog.create([{ actorUserId: parent.id, action: "family.notify_prefs", targetType: "family", targetId: fid, details: { ...prefs } }], { session });
  });
  return true;
}

// ── Signed unsubscribe tokens ─────────────────────────────────────────────────────────

const sign = (fid: string, kind: UnsubScope) => createHmac("sha256", sessionPurposeKey("sos/unsubscribe/v1")).update(`${fid}.${kind}`).digest("base64url");

/** Shape check for untrusted input (Zod, like every input): a short string, nothing else. */
export const unsubscribeTokenSchema = z.string().min(30).max(120);

export function unsubscribeToken(familyId: string, kind: UnsubScope): string {
  return `${familyId}.${kind}.${sign(familyId, kind)}`;
}

/** The family + kind a token is for, or null if it's malformed or the signature is wrong. */
export function readUnsubscribeToken(token: unknown): { familyId: string; kind: UnsubScope } | null {
  const parsed = unsubscribeTokenSchema.safeParse(token);
  if (!parsed.success) return null;
  const parts = parsed.data.split(".");
  if (parts.length !== 3) return null; // exact format: nothing may be appended
  const [fid, kind, sig] = parts;
  if (!fid || !OBJECT_ID_RE.test(fid) || !isScope(kind) || !sig) return null;
  const want = Buffer.from(sign(fid, kind));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? { familyId: fid, kind } : null; // constant-time compare
}

/** Switch one scope OFF via a signed link (no sign-in). Idempotent. Returns the scope, or null for a bad link. */
export async function unsubscribe(token: unknown): Promise<UnsubScope | null> {
  const t = readUnsubscribeToken(token);
  if (!t) return null;
  await connectDb();
  const found = await withTransaction(async (session) => {
    const off = Object.fromEntries(SCOPE_KINDS[t.kind].map((k) => [`notify.${k}`, false]));
    const res = await Family.updateOne({ _id: t.familyId }, { $set: off }, { session });
    if (res.modifiedCount === 1) {
      await AuditLog.create([{ action: "family.notify_prefs", targetType: "family", targetId: t.familyId, details: { scope: t.kind, by: "unsubscribe_link" } }], { session });
    }
    return res.matchedCount === 1;
  });
  return found ? t.kind : null;
}

/** Footer + header links for one notification email to this family. */
export function optOutLinksFor(familyId: string, kind: UnsubScope, locale: Locale): OptOutLinks {
  const origin = familyAppOrigin();
  const t = encodeURIComponent(unsubscribeToken(familyId, kind));
  return {
    optOut: `${origin}${localizePath("/unsubscribe", locale)}?t=${t}`,
    oneClick: `${origin}/api/unsubscribe?t=${t}`,
    manage: `${origin}${localizePath("/parent/notifications", locale)}`,
  };
}
