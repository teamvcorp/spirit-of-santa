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
import { AuditLog, connectDb, Season, withTransaction, type AuditAction } from "@repo/db";
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

/** Only the fields the rules need (this runs on every item change: keep it small). */
const FIELDS = "year openDate freezeDate closeDate forceFrozen storeWindow";
const loadSeason = (year: number) => Season.findOne({ year }).select(FIELDS).lean<SeasonDocLite>();

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

/**
 * Get (or create) the season document so changes and audit rows have an id. Only called AFTER
 * input was validated, so a rejected request never creates a document (review 2026-11-05).
 */
async function ensureSeason(year: number): Promise<SeasonDocLite> {
  const upsert = () =>
    Season.findOneAndUpdate({ year }, { $setOnInsert: { year } }, { upsert: true, returnDocument: "after" }).select(FIELDS).lean<SeasonDocLite>();
  try {
    return (await upsert())!;
  } catch (err) {
    // Two first writes racing to create the year's document: one wins (11000), read it.
    if ((err as { code?: number }).code !== 11000) throw err;
    return (await upsert())!;
  }
}

/**
 * Change + audit row in ONE transaction: a change is never live without its audit record.
 * The filter carries the value we read (compare-and-set): if another admin changed it in
 * between, nothing is written and the caller reports "changed".
 */
async function changeAudited(
  adminId: string,
  doc: SeasonDocLite,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  action: AuditAction,
  details: Record<string, unknown>,
): Promise<boolean> {
  return withTransaction(async (session) => {
    const res = await Season.updateOne({ _id: doc._id, ...filter }, update, { session, runValidators: true });
    if (res.matchedCount !== 1) return false;
    await AuditLog.create([{ actorUserId: adminId, action, targetType: "season", targetId: String(doc._id), details }], { session });
    return true;
  });
}

export type SeasonResult = { ok: true } | { ok: false; error: SeasonDatesError | "changed" | "notOpen" };

/** Store item window: auto (Jan 1–Mar 31) / open now / closed now. Current season only. */
export async function setStoreWindow(adminId: string, mode: StoreWindowMode, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const doc = await ensureSeason(getSeasonYear(now));
  const from = doc.storeWindow ?? "auto";
  if (from === mode) return { ok: true };
  // `field: null` matches "missing or null": the compare-and-set also works for unset fields.
  const ok = await changeAudited(adminId, doc, { storeWindow: doc.storeWindow ?? null }, { $set: { storeWindow: mode, updatedByUserId: adminId } }, "season.store_window", { year: doc.year, from, to: mode });
  return ok ? { ok: true } : { ok: false, error: "changed" };
}

/**
 * Emergency switch: freeze wish lists now. Turning it ON is only allowed while the season is
 * OPEN: switched on in the off-season it would silently freeze the season from opening day
 * (review 2026-11-05). Turning it off is always allowed.
 */
export async function setForceFrozen(adminId: string, on: boolean, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const year = getSeasonYear(now);
  if (on) {
    const state = resolveSeason(now, (await loadSeason(year)) ?? {});
    if (state.phase !== "open") return { ok: false, error: "notOpen" };
  }
  const doc = await ensureSeason(year);
  const from = doc.forceFrozen === true;
  if (from === on) return { ok: true };
  const ok = await changeAudited(adminId, doc, { forceFrozen: doc.forceFrozen ?? null }, { $set: { forceFrozen: on, updatedByUserId: adminId } }, "season.force_freeze", { year, from, to: on });
  return ok ? { ok: true } : { ok: false, error: "changed" };
}

export type SeasonDatesInput = { openDate?: string; freezeDate?: string; closeDate?: string };

/**
 * Custom dates for the current or next season (blank = default). Refused once that season has
 * opened. Validated BEFORE anything is written; the write only applies if the dates are still
 * what we validated against ("changed": reload and retry).
 */
export async function setSeasonDates(adminId: string, year: number, input: SeasonDatesInput, now = new Date()): Promise<SeasonResult> {
  await connectDb();
  const thisYear = getSeasonYear(now);
  if (year !== thisYear && year !== thisYear + 1) return { ok: false, error: "wrongYear" };
  const current = (await loadSeason(year)) ?? null;
  const clean = (v?: string) => (v && v.trim() ? v.trim() : null);
  const next = { openDate: clean(input.openDate), freezeDate: clean(input.freezeDate), closeDate: clean(input.closeDate) };
  const error = validateSeasonDates(year, next, current ?? {}, now);
  if (error) return { ok: false, error };
  const before = { openDate: current?.openDate ?? null, freezeDate: current?.freezeDate ?? null, closeDate: current?.closeDate ?? null };
  if (before.openDate === next.openDate && before.freezeDate === next.freezeDate && before.closeDate === next.closeDate) return { ok: true };
  const doc = await ensureSeason(year);
  const set: Record<string, unknown> = { updatedByUserId: adminId };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v) set[k] = v;
    else unset[k] = 1;
  }
  const ok = await changeAudited(adminId, doc, before, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, "season.dates", { year, from: before, to: next });
  return ok ? { ok: true } : { ok: false, error: "changed" };
}
