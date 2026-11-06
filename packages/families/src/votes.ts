/**
 * Daily Naughty/Nice vote (parent area, PIN). SERVER-ONLY. Rules (roadmap Phase 4):
 *  - one vote per child per day (season time zone); the parent may change it that same day;
 *  - a day WITHOUT a vote counts as Nice (computed here, never stored);
 *  - counted per season year: everything starts fresh on January 1.
 * Callers: requireParent + PIN unlock for voting; the tally is fine for the kid's own page.
 */
import "server-only";
import { Kid, KidVote, trusted } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { ownFamilyId, type Parent } from "./kids.ts";

export type Tally = { nice: number; naughty: number; today?: "nice" | "naughty" };

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Days counted so far this season year, including today: from Jan 1 or from the day the kid was
 * added (whichever is later). Pure: exported for unit tests.
 */
export function daysSoFar(todayIso: string, kidCreatedIso: string): number {
  const jan1 = `${todayIso.slice(0, 4)}-01-01`;
  const from = kidCreatedIso > jan1 ? kidCreatedIso : jan1;
  return Math.max(0, dayNumber(todayIso) - dayNumber(from) + 1);
}

export type VoteResult = { ok: true } | { ok: false; error: "notFound" };

/** Set (or change) today's vote for one of the parent's kids. */
export async function castVote(parent: Parent, rawKidId: string, vote: "nice" | "naughty", now = new Date()): Promise<VoteResult> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid || !(await Kid.exists({ _id: kidId, familyId: fid, archivedAt: null }))) return { ok: false, error: "notFound" };
  const day = isoDay(calendarDateIn(now));
  await KidVote.updateOne(
    { kidId, day },
    { $set: { vote }, $setOnInsert: { familyId: fid, seasonYear: getSeasonYear(now) } },
    { upsert: true, runValidators: true },
  );
  return { ok: true };
}

/** This season year's tally for each of the family's kids (id → tally). */
export async function familyTallies(parent: Parent, now = new Date()): Promise<Map<string, Tally>> {
  const fid = await ownFamilyId(parent);
  const out = new Map<string, Tally>();
  if (!fid) return out;
  const year = getSeasonYear(now);
  const today = isoDay(calendarDateIn(now));
  const [kids, votes] = await Promise.all([
    Kid.find({ familyId: fid, archivedAt: null }).select("createdAt").lean(),
    KidVote.find({ familyId: fid, seasonYear: year, day: trusted({ $lte: today }) }).select("kidId day vote").lean(),
  ]);
  for (const k of kids) {
    const mine = votes.filter((v) => String(v.kidId) === String(k._id));
    const naughty = mine.filter((v) => v.vote === "naughty").length;
    const days = daysSoFar(today, isoDay(calendarDateIn(new Date(k.createdAt))));
    const t = mine.find((v) => v.day === today)?.vote;
    out.set(String(k._id), { nice: Math.max(0, days - naughty), naughty, ...(t ? { today: t } : {}) });
  }
  return out;
}
