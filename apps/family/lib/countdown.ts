/**
 * Home-page countdowns (owner 2026-11-08). ALWAYS from the season's real dates (admin-adjustable freeze date,
 * America/Chicago calendar days), never a typed-in "December 1".
 *
 * Teaching note: counting "days until" with two midnights in the SAME time zone and rounding keeps it right
 * across daylight-saving changes (one of those days is 23 or 25 hours long).
 */
import "server-only";
import { cache } from "react";
import { calendarDateIn, isoDay, startOfDayInZone, type SeasonState } from "@repo/lib/season";
import { DAY_MS } from "@repo/lib/time";
import { getSeasonState } from "@repo/stores/season";

/** Whole calendar days from today (Chicago) to `day` ("YYYY-MM-DD"); negative once it has passed. */
export function daysUntil(day: string, now = new Date()): number {
  const today = isoDay(calendarDateIn(now));
  return Math.round((startOfDayInZone(day).getTime() - startOfDayInZone(today).getTime()) / DAY_MS);
}

export type HomeCountdown =
  /** Before the freeze: Secret Santa gifts are shared on `freeze`. */
  | { phase: "open"; nights: number; shareDays: number; freeze: Date; shipBy: Date }
  /**
   * The admin FORCE-FROZE an open season (before the freeze date): giving is paused, but nothing has been shared
   * (the split only runs on the freeze DATE), and it may reopen. Review of 5165c1d.
   */
  | { phase: "paused"; nights: number; shipBy: Date }
  /** Freeze DATE reached → Christmas: Secret Santa gifts shared, stores shipping. */
  | { phase: "shared"; nights: number; shipBy: Date }
  /** Closed (Dec 26–31) or the Jan 1 reset: no countdown (the season notice explains). */
  | { phase: "off" };

/** Pure: the countdown for a season state at `now` (exported for checks). */
export function buildHomeCountdown(s: SeasonState, now: Date): HomeCountdown {
  const christmas = `${s.year}-12-25`;
  const nights = daysUntil(christmas, now);
  if ((s.phase !== "open" && s.phase !== "frozen") || nights < 0) return { phase: "off" };
  const shipBy = startOfDayInZone(s.shipBy);
  // "Shared" is decided by the freeze DATE (datesLocked = today >= freeze), never by the phase alone: a
  // force-freeze also reports phase "frozen" but shares nothing.
  if (s.datesLocked) return { phase: "shared", nights, shipBy };
  if (s.phase === "frozen") return { phase: "paused", nights, shipBy };
  return { phase: "open", nights, shareDays: daysUntil(s.dates.freeze, now), freeze: startOfDayInZone(s.dates.freeze), shipBy };
}

/** One season read per request, shared by the hero pill, the band and the Secret Santa card. */
export const homeCountdown = cache(async (): Promise<HomeCountdown> => buildHomeCountdown(await getSeasonState(), new Date()));
