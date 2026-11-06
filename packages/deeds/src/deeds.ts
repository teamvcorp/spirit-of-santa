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
 *  - QR: single use, DEED_QR_DAYS valid (qr.ts for the token scheme); MAX_DEEDS_PER_KID_PER_DAY.
 */
import "server-only";
import QRCode from "qrcode";
import { hitRateLimit } from "@repo/auth/rate-limit";
import { AuditLog, Deed, DeedType, Kid, trusted, withTransaction } from "@repo/db";
import { ownFamilyId, type Parent } from "@repo/families/kids";
import { normalizeObjectId } from "@repo/lib/ids";
import { DEED_QR_DAYS, MAX_DEEDS_PER_KID_PER_DAY } from "@repo/lib/limits";
import type { Locale } from "@repo/lib/locales";
import { getSeasonState } from "@repo/stores/season";
import mongoose from "mongoose";
import { deedToken, hashDeedToken } from "./qr.ts";

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
  // Daily cap per kid (fixed UTC-day window, like other limits).
  if (!(await hitRateLimit(`deed-create:${kid.kidId}`, MAX_DEEDS_PER_KID_PER_DAY, 86_400))) return { ok: false, error: "dailyLimit" };

  // The id is chosen first so the QR token (HMAC of the id) can be hashed into the same insert.
  const _id = new mongoose.Types.ObjectId();
  const deedId = String(_id);
  await withTransaction(async (session) => {
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
          expiresAt: new Date(Date.now() + DEED_QR_DAYS * 86_400_000),
        },
      ],
      { session },
    );
    // Audit: ids only (no free text: it may describe the child).
    await AuditLog.create([{ actorUserId: parent.id, action: "deed.create", targetType: "kid", targetId: kid.kidId, details: { deedId, custom: !deedTypeId } }], { session });
  });
  return { ok: true, deedId };
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
};

/**
 * A kid's recent deeds (newest first) for the kid's own page, with QR codes for the usable ones.
 * `origin` = the family app's public URL (QR links point there).
 */
export async function listKidDeeds(parent: Parent, rawKidId: string, origin: string): Promise<KidDeedRow[] | null> {
  const kid = await ownKid(parent, rawKidId);
  if (!kid) return null;
  const deeds = await Deed.find({ kidId: kid.kidId, familyId: kid.fid }).sort({ createdAt: -1 }).limit(20).lean();
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
        qr = { url, image: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 220 }) };
      }
      return {
        id,
        title: d.deedTypeId ? (titleOf.get(String(d.deedTypeId)) ?? {}) : {},
        custom: d.customDescription ?? undefined,
        status: usable ? "pending" : d.status === "pending" ? "expired" : d.status,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt ?? undefined,
        qr,
      };
    }),
  );
}
