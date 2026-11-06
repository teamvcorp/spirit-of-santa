/**
 * Season state + admin season controls (Phase 3 slice 2). SERVER-ONLY.
 *
 *   const s = await getSeasonState();   // phase, store window, dates (DB overrides applied)
 *
 * EVERY server check about "is the season open / frozen / is the store window open" must use
 * getSeasonState(), never the default-calendar helpers alone, or admin changes are ignored.
 * The rules themselves are pure and unit-tested: resolveSeason / validateSeasonDates in
 * @repo/lib/season.
 *
 * Admin controls (user decisions 2026-11-05):
 *  - Dates (open / freeze / close) for the current or next season, ONLY before that season
 *    opens; once open they lock.
 *  - Store item window switch (auto / open / closed) and force-freeze: any time.
 * Callers must check the admin role first (requireRole). Every change is audited (before/after).
 */
import "server-only";
import { AuditLog, connectDb, Season, type AuditAction } from "@repo/db";
import {
  defaultSeasonDates,
  getSeasonYear,
  resolveSeason,
  validateSeasonDates,
  type SeasonDatesError,
  type SeasonState,
  type StoreWindowMode,
} from "@repo/lib/season";

type SeasonDocLite = {
  _id: unknown;
  year: number;
  openDate?: string | null;
  freezeDate?: string | null;
  closeDate?: string | null;
  forceFrozen?: boolean | null;
  storeWindow?: StoreWindowMode | null;
};

const loadSeason = (year: number) => Season.findOne({ year }).lean<SeasonDocLite>();

/** The season right now, with any admin overrides applied. */
export async function getSeasonState(now = new Date()): Promise<SeasonState> {
  await connectDb();
  const doc = await loadSeason(getSeasonYear(now));
  return resolveSeason(now, doc ?? {});
}

/** What the admin /season page shows: this season (live state) and next season (dates only). */
export async function seasonAdminView(now = new Date()) {
  await connectDb();
  const year = getSeasonYear(now);
  const [cur, next] = await Promise.all([loadSeason(year), loadSeason(year + 1)]);
  const nextDef = defaultSeasonDates(year + 1);
  return {
    current: {
      state: resolveSeason(now, cur ?? {}),
      custom: { openDate: cur?.openDate ?? "", freezeDate: cur?.freezeDate ?? "", closeDate: cur?.closeDate ?? "" },
      defaults: defaultSeasonDates(year),
    },
    next: {
      year: year + 1,
      custom: { openDate: next?.openDate ?? "", freezeDate: next?.freezeDate ?? "", closeDate: next?.closeDate ?? "" },
      defaults: nextDef,
    },
  };
}

/** Get (or create) the season document so changes and audit rows have an id. */
async function ensureSeason(year: number): Promise<SeasonDocLite> {
  const upsert = () =>
    Season.findOneAndUpdate({ year }, { $setOnInsert: { year } }, { upsert: true, returnDocument: "after" }).lean<SeasonDocLite>();
  try {
    return (await upsert())!;
  } catch (err) {
    // Two first writes racing to create the year's document: one wins (11000), read it.
    if ((err as { code?: number }).code !== 11000) throw err;
    return (await upsert())!;
  }
}

async function audit(adminId: string, action: AuditAction, seasonId: unknown, details: Record<string, unknown>) {
  await AuditLog.create({ actorUserId: adminId, action, targetType: "season", targetId: String(seasonId), details });
}

export type SeasonResult = { ok: true } | { ok: false; error: SeasonDatesError | "wrongYear" | "changed" };

/** Store item window: auto (Jan 1–Mar 31) / open now / closed now. Current season only. */
export async function setStoreWindow(adminId: string, mode: StoreWindowMode, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const doc = await ensureSeason(getSeasonYear(now));
  const from = doc.storeWindow ?? "auto";
  if (from === mode) return { ok: true };
  await Season.updateOne({ _id: doc._id }, { $set: { storeWindow: mode, updatedByUserId: adminId } });
  await audit(adminId, "season.store_window", doc._id, { year: doc.year, from, to: mode });
  return { ok: true };
}

/** Emergency switch: freeze wish lists now (only matters while the season is open). */
export async function setForceFrozen(adminId: string, on: boolean, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const doc = await ensureSeason(getSeasonYear(now));
  const from = doc.forceFrozen === true;
  if (from === on) return { ok: true };
  await Season.updateOne({ _id: doc._id }, { $set: { forceFrozen: on, updatedByUserId: adminId } });
  await audit(adminId, "season.force_freeze", doc._id, { year: doc.year, from, to: on });
  return { ok: true };
}

export type SeasonDatesInput = { openDate?: string; freezeDate?: string; closeDate?: string };

/**
 * Custom dates for the current or next season (blank = default). Refused once that season has
 * opened. The update only applies if the dates are still what we validated against, so two
 * admins saving at once can't slip a change past the checks ("changed": reload and retry).
 */
export async function setSeasonDates(adminId: string, year: number, input: SeasonDatesInput, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const thisYear = getSeasonYear(now);
  if (year !== thisYear && year !== thisYear + 1) return { ok: false, error: "wrongYear" };
  const doc = await ensureSeason(year);
  const clean = (v?: string) => (v && v.trim() ? v.trim() : null);
  const next = { openDate: clean(input.openDate), freezeDate: clean(input.freezeDate), closeDate: clean(input.closeDate) };
  const error = validateSeasonDates(year, next, doc, now);
  if (error) return { ok: false, error };
  const before = { openDate: doc.openDate ?? null, freezeDate: doc.freezeDate ?? null, closeDate: doc.closeDate ?? null };
  if (before.openDate === next.openDate && before.freezeDate === next.freezeDate && before.closeDate === next.closeDate) return { ok: true };
  const set: Record<string, unknown> = { updatedByUserId: adminId };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v) set[k] = v;
    else unset[k] = 1;
  }
  // \`field: null\` matches "missing or null": the compare-and-set works for unset fields too.
  const res = await Season.updateOne(
    { _id: doc._id, openDate: before.openDate, freezeDate: before.freezeDate, closeDate: before.closeDate },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { runValidators: true },
  );
  if (res.matchedCount !== 1) return { ok: false, error: "changed" };
  await audit(adminId, "season.dates", doc._id, { year, from: before, to: next });
  return { ok: true };
}
