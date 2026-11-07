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
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { AuditLog, connectDb, Family, withTransaction } from "@repo/db";
import type { OptOutLinks } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import type { Locale } from "@repo/lib/locales";
import { familyAppOrigin } from "@repo/stores/urls";

export const NOTIFY_KINDS = ["magic", "deeds", "reminders"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type NotifyPrefs = Record<NotifyKind, boolean>;

const isKind = (v: unknown): v is NotifyKind => typeof v === "string" && (NOTIFY_KINDS as readonly string[]).includes(v);
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

function tokenKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", "sos/unsubscribe/v1", 32));
}
const sign = (fid: string, kind: NotifyKind) => createHmac("sha256", tokenKey()).update(`${fid}.${kind}`).digest("base64url");

export function unsubscribeToken(familyId: string, kind: NotifyKind): string {
  return `${familyId}.${kind}.${sign(familyId, kind)}`;
}

/** The family + kind a token is for, or null if it's malformed or the signature is wrong. */
export function readUnsubscribeToken(token: unknown): { familyId: string; kind: NotifyKind } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const [fid, kind, sig] = token.split(".");
  if (!fid || !OBJECT_ID_RE.test(fid) || !isKind(kind) || !sig) return null;
  const want = Buffer.from(sign(fid, kind));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? { familyId: fid, kind } : null; // constant-time compare
}

/** Switch one kind OFF via a signed link (no sign-in). Idempotent. Returns the kind, or null for a bad link. */
export async function unsubscribe(token: unknown): Promise<NotifyKind | null> {
  const t = readUnsubscribeToken(token);
  if (!t) return null;
  await connectDb();
  const res = await Family.updateOne({ _id: t.familyId }, { $set: { [`notify.${t.kind}`]: false } });
  if (res.matchedCount === 1 && res.modifiedCount === 1) {
    await AuditLog.create({ action: "family.notify_prefs", targetType: "family", targetId: t.familyId, details: { [t.kind]: false, by: "unsubscribe_link" } });
  }
  return res.matchedCount === 1 ? t.kind : null;
}

/** Footer + header links for one notification email to this family. */
export function optOutLinksFor(familyId: string, kind: NotifyKind, locale: Locale): OptOutLinks {
  const origin = familyAppOrigin();
  const t = encodeURIComponent(unsubscribeToken(familyId, kind));
  return {
    optOut: `${origin}${localizePath("/unsubscribe", locale)}?t=${t}`,
    oneClick: `${origin}/api/unsubscribe?t=${t}`,
    manage: `${origin}${localizePath("/parent/notifications", locale)}`,
  };
}
