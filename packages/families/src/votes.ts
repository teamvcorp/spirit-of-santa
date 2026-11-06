/**
 * Daily Naughty/Nice vote (parent area, PIN). SERVER-ONLY. Rules (roadmap Phase 4):
 *  - one vote per child per day (season time zone); the parent may change it that same day;
 *  - a day WITHOUT a vote counts as Nice (computed here, never stored);
 *  - voting runs ALL YEAR; each list covers Dec 26 → Dec 25 (Central Time): Christmas Day ends a
 *    list and from Dec 26 votes build NEXT Christmas's list (user decision 2026-11-06);
 *  - Nice days start when the child was REGISTERED (consent verified), not merely added.
 * Every vote change is audited (ids + vote only). Callers: requireParent + PIN unlock for voting.
 */
import "server-only";
import { AuditLog, Kid, KidVote, trusted, withTransaction } from "@repo/db";
import type { KidVoteValue } from "@repo/lib/family";
import { normalizeObjectId } from "@repo/lib/ids";
import { calendarDateIn, isoDay, santaListStart, santaListYear } from "@repo/lib/season";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";

export type Tally = { nice: number; naughty: number; today?: KidVoteValue; listYear: number };

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Days counted so far on the CURRENT list, including today: from the list's start (Dec 26) or the
 * day the kid was registered (whichever is later). Pure: exported for unit tests.
 */
export function daysSoFar(todayIso: string, fromIso: string): number {
  const start = santaListStart(santaListYear(todayIso));
  const from = fromIso > start ? fromIso : start;
  return Math.max(0, dayNumber(todayIso) - dayNumber(from) + 1);
}

export type VoteResult = { ok: true } | { ok: false; error: "notFound" | "notRegistered" };

/** Set (or change) today's vote for one of the parent's REGISTERED kids. Audited. */
export async function castVote(parent: Parent, rawKidId: string, vote: KidVoteValue, now = new Date()): Promise<VoteResult> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return { ok: false, error: "notFound" };
  const kid = await Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null }).select("registration.status").lean();
  if (!kid) return { ok: false, error: "notFound" };
  if (kid.registration?.status !== "registered") return { ok: false, error: "notRegistered" };
  const day = isoDay(calendarDateIn(now));
  await withTransaction(async (session) => {
    await KidVote.updateOne(
      { kidId, day },
      { $set: { vote }, $setOnInsert: { familyId: fid, seasonYear: santaListYear(day) } },
      { upsert: true, runValidators: true, session },
    );
    await AuditLog.create([{ actorUserId: parent.id, action: "kid.vote", targetType: "kid", targetId: kidId, details: { day, vote } }], { session });
  });
  return { ok: true };
}

type KidLite = { _id: unknown; createdAt: Date; registration?: { status?: string | null; registeredAt?: Date | null } | null };

function tallyFor(kid: KidLite, votes: { day: string; vote: string }[], today: string): Tally | null {
  if (kid.registration?.status !== "registered") return null; // no tally before consent is verified
  const from = kid.registration.registeredAt ?? kid.createdAt;
  const naughty = votes.filter((v) => v.vote === "naughty").length;
  const days = daysSoFar(today, isoDay(calendarDateIn(new Date(from))));
  const t = votes.find((v) => v.day === today)?.vote as KidVoteValue | undefined;
  return { nice: Math.max(0, days - naughty), naughty, listYear: santaListYear(today), ...(t ? { today: t } : {}) };
}

/** This season year's tally for each of the family's REGISTERED kids (id → tally). One pass. */
export async function familyTallies(parent: Parent, now = new Date()): Promise<Map<string, Tally>> {
  const fid = await ownFamilyId(parent);
  const out = new Map<string, Tally>();
  if (!fid) return out;
  const today = isoDay(calendarDateIn(now));
  const [kids, votes] = await Promise.all([
    Kid.find({ familyId: fid, archivedAt: null }).select("createdAt registration").lean<KidLite[]>(),
    KidVote.find({ familyId: fid, seasonYear: santaListYear(today), day: trusted({ $lte: today }) }).select("kidId day vote").lean(),
  ]);
  const byKid = new Map<string, { day: string; vote: string }[]>();
  for (const v of votes) {
    const k = String(v.kidId);
    byKid.set(k, [...(byKid.get(k) ?? []), v]);
  }
  for (const k of kids) {
    const t = tallyFor(k, byKid.get(String(k._id)) ?? [], today);
    if (t) out.set(String(k._id), t);
  }
  return out;
}

/** One child's tally (the kid page): only that child's votes are read. */
export async function kidTally(parent: Parent, rawKidId: string, now = new Date()): Promise<Tally | null> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return null;
  const today = isoDay(calendarDateIn(now));
  const [kid, votes] = await Promise.all([
    Kid.findOne({ _id: kidId, familyId: fid, archivedAt: null }).select("createdAt registration").lean<KidLite>(),
    KidVote.find({ kidId, seasonYear: santaListYear(today), day: trusted({ $lte: today }) }).select("day vote").lean(),
  ]);
  return kid ? tallyFor(kid, votes, today) : null;
}
