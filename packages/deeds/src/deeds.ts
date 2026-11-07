/**
 * Kids' deeds (family app). SERVER-ONLY. Callers: signed-in parent (requireRole "parent");
 * RECORDING a deed also needs the PIN unlock (checked by the caller AND here via the parent).
 *
 * Rules (Phase 4 slice 3, decisions 2026-11-05):
 *  - Only REGISTERED kids (consent verified) of the parent's own family get deeds/QR codes: the QR
 *    page shows the kid's display name publicly.
 *  - Only while the season is open or frozen (getSeasonState: admin overrides included); tips can
 *    still fund items until it closes.
 *  - A catalog deed must be ACTIVE; "other" text waits for admin approval before it's shown
 *    publicly (customReview).
 *  - QR: single use; valid DEED_QR_DAYS but never past the season's close (qr.ts: token scheme).
 *  - MAX_DEEDS_PER_KID_PER_DAY counts the kid's actual deeds since midnight Chicago time, under a
 *    per-kid lock (concurrent submits take turns; a failed attempt uses nothing up).
 */
import "server-only";
import { AuditLog, Deed, DeedType, ensureLock, Kid, takeLock, trusted, withTransaction } from "@repo/db";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { normalizeObjectId } from "@repo/lib/ids";
import { DAY_MS } from "@repo/lib/time";
import { DEED_QR_DAYS, MAX_DEEDS_PER_KID_PER_DAY } from "@repo/lib/limits";
import type { Locale } from "@repo/lib/locales";
import { calendarDateIn, isoDay, startOfDayInZone } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";
import mongoose from "mongoose";
import { deedToken, hashDeedToken, qrDataUrl } from "./qr.ts";
import { isThankNote, type ThankNote } from "@repo/lib/thank-notes";
import { localized } from "./catalog.ts";

export type RecordInput = { deedTypeId: string } | { other: string };
export type RecordResult = { ok: true; deedId: string } | { ok: false; error: "notFound" | "notRegistered" | "seasonClosed" | "deedUnavailable" | "dailyLimit" };

/** The parent's kid (own family, not archived), or null. */
async function ownKid(parent: Parent, rawKidId: string) {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return null;
  const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null }).select("registration.status").lean();
  return kid ? { kidId, fid, registered: kid.registration?.status === "registered" } : null;
}

export async function recordDeed(parent: Parent, rawKidId: string, input: RecordInput, locale: Locale): Promise<RecordResult> {
  const kid = await ownKid(parent, rawKidId);
  if (!kid) return { ok: false, error: "notFound" };
  if (!kid.registered) return { ok: false, error: "notRegistered" };
  const season = await getSeasonState();
  if (season.phase !== "open" && season.phase !== "frozen") return { ok: false, error: "seasonClosed" };
  let deedTypeId: string | undefined;
  if ("deedTypeId" in input) {
    const id = normalizeObjectId(input.deedTypeId);
    if (!id || !(await DeedType.exists({ _id: id, active: true }))) return { ok: false, error: "deedUnavailable" };
    deedTypeId = id;
  }
  const now = new Date();
  const todayStart = startOfDayInZone(isoDay(calendarDateIn(now)));
  // Never valid past the season's close (midnight starting the close day, Chicago time).
  const expiresAt = new Date(Math.min(now.getTime() + DEED_QR_DAYS * DAY_MS, startOfDayInZone(season.dates.close).getTime()));

  // The id is chosen first so the QR token (HMAC of the id) can be hashed into the same insert.
  const _id = new mongoose.Types.ObjectId();
  const deedId = String(_id);
  const lock = `kid-deeds:${kid.kidId}`;
  await ensureLock(lock);
  const created = await withTransaction(async (session) => {
    await takeLock(lock, session);
    // The child may have been deleted since it was looked up (families/erase.ts takes this same lock).
    if (!(await Kid.exists({ _id: kid.kidId }).session(session))) return "gone" as const;
    const today = await Deed.countDocuments({ kidId: kid.kidId, createdAt: trusted({ $gte: todayStart }) }).session(session);
    if (today >= MAX_DEEDS_PER_KID_PER_DAY) return "dailyLimit" as const;
    await Deed.create(
      [
        {
          _id,
          kidId: kid.kidId,
          familyId: kid.fid,
          seasonYear: season.year,
          ...(deedTypeId ? { deedTypeId } : { customDescription: (input as { other: string }).other, customReview: "pending" }),
          locale,
          status: "pending",
          qrTokenHash: hashDeedToken(deedToken(deedId)),
          expiresAt,
        },
      ],
      { session },
    );
    // Audit: ids only (no free text: it may describe the child).
    await AuditLog.create([{ actorUserId: parent.id, action: "deed.create", targetType: "kid", targetId: kid.kidId, details: { deedId, custom: !deedTypeId } }], { session });
    return true;
  });
  if (created === "gone") return { ok: false, error: "notFound" };
  return created === true ? { ok: true, deedId } : { ok: false, error: "dailyLimit" };
}

// ── Thank-you notes waiting for the parent (owner 2026-11-07) ─────────────────────────────

export type PendingThankNote = { deedId: string; kidId: string; kidName: string; deed: string; note: ThankNote };

/** The family's thank-you notes waiting for approval (oldest first). Only the parent's OWN family. */
export async function listPendingThankNotes(parent: Parent, locale: Locale, aDeed: string): Promise<PendingThankNote[]> {
  const fid = await ownFamilyId(parent);
  if (!fid) return [];
  const rows = await Deed.find({ familyId: fid, thankNoteReview: "pending" })
    .sort({ confirmedAt: 1, _id: 1 })
    .limit(50)
    .select("kidId deedTypeId customDescription customReview thankNote")
    .lean<{ _id: unknown; kidId: unknown; deedTypeId?: unknown; customDescription?: string; customReview?: string; thankNote?: string }[]>();
  if (rows.length === 0) return [];
  const [kids, types] = await Promise.all([
    Kid.find({ _id: trusted({ $in: [...new Set(rows.map((r) => String(r.kidId)))] }), familyId: fid }).select("firstName").lean<{ _id: unknown; firstName: string }[]>(),
    DeedType.find({ _id: trusted({ $in: rows.map((r) => r.deedTypeId).filter(Boolean).map(String) }) }).select("title").lean(),
  ]);
  const kidName = new Map(kids.map((k) => [String(k._id), k.firstName]));
  const typeTitle = new Map(types.map((t) => [String(t._id), localized(t.title ?? undefined, locale)]));
  return rows
    .filter((r) => isThankNote(r.thankNote) && kidName.has(String(r.kidId)))
    .map((r) => ({
      deedId: String(r._id),
      kidId: String(r.kidId),
      kidName: kidName.get(String(r.kidId))!,
      // The family's own deed text (their child typed it), or the catalogue title.
      deed: (r.deedTypeId ? typeTitle.get(String(r.deedTypeId)) : r.customDescription) || aDeed,
      note: r.thankNote as ThankNote,
    }));
}

/** Parent approves (the child sees it) or hides a thank-you note. Compare-and-set on "pending", own family only. */
export async function reviewThankNote(parent: Parent, rawDeedId: string, decision: "approved" | "hidden"): Promise<{ ok: boolean }> {
  const id = normalizeObjectId(rawDeedId);
  const fid = await ownFamilyId(parent);
  if (!id || !fid) return { ok: false };
  const r = await Deed.updateOne({ _id: id, familyId: fid, thankNoteReview: "pending" }, { $set: { thankNoteReview: decision } });
  return { ok: r.modifiedCount === 1 };
}

export type KidDeedRow = {
  id: string;
  title: { en?: string; es?: string };
  custom?: string;
  status: string;
  createdAt: Date;
  expiresAt?: Date;
  /** Present only while the QR code can still be used: the link + a QR image (data URL). */
  qr?: { url: string; image: string };
  /** A thank-you note the PARENT approved (never shown before that). */
  note?: ThankNote;
};

/**
 * A kid's deeds for the kid's own page: EVERY still-usable one (with its QR code) plus the 20
 * most recent others, newest first. `origin` = the family app's public URL (QR links point there).
 */
export async function listKidDeeds(parent: Parent, rawKidId: string, origin: string): Promise<KidDeedRow[] | null> {
  const kid = await ownKid(parent, rawKidId);
  if (!kid) return null;
  const scope = { kidId: kid.kidId, familyId: kid.fid };
  const usableFilter = { status: "pending" as const, qrUsedAt: null, expiresAt: trusted({ $gt: new Date() }) };
  // Usable codes are bounded by the daily cap x 14 days; history is capped at 20.
  const [usable, recent] = await Promise.all([
    Deed.find({ ...scope, ...usableFilter }).sort({ createdAt: -1 }).limit(MAX_DEEDS_PER_KID_PER_DAY * DEED_QR_DAYS).lean(),
    Deed.find(scope).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const seen = new Set(usable.map((d) => String(d._id)));
  const deeds = [...usable, ...recent.filter((d) => !seen.has(String(d._id)))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const typeIds = [...new Set(deeds.map((d) => (d.deedTypeId ? String(d.deedTypeId) : null)).filter((v): v is string => Boolean(v)))];
  const types = typeIds.length ? await DeedType.find({ _id: trusted({ $in: typeIds }) }).select("title").lean() : [];
  const titleOf = new Map(types.map((t) => [String(t._id), { en: t.title?.en ?? undefined, es: t.title?.es ?? undefined }]));
  const now = Date.now();
  return Promise.all(
    deeds.map(async (d) => {
      const id = String(d._id);
      const usable = d.status === "pending" && !d.qrUsedAt && (!d.expiresAt || new Date(d.expiresAt).getTime() > now);
      let qr: KidDeedRow["qr"];
      if (usable) {
        const url = new URL(`/d/${deedToken(id)}`, origin).toString();
        qr = { url, image: await qrDataUrl(url) };
      }
      return {
        id,
        title: d.deedTypeId ? (titleOf.get(String(d.deedTypeId)) ?? {}) : {},
        custom: d.customDescription ?? undefined,
        // A scanned code (qrUsedAt) that's still pending is being handled (e.g. payment), not expired.
        status: usable ? "pending" : d.status === "pending" ? (d.qrUsedAt ? "processing" : "expired") : d.status,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt ?? undefined,
        qr,
        note: d.thankNoteReview === "approved" && isThankNote(d.thankNote) ? d.thankNote : undefined,
      };
    }),
  );
}
