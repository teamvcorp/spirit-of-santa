/**
 * Season calendar. CLIENT-SAFE.
 *
 * Every date rule is evaluated in ONE time zone, so "Dec 1 freeze" happens at the same
 * instant for every user and server (Vercel servers run in UTC; without this, the freeze
 * would hit at 6 pm Nov 30 for Iowa families).
 *
 * These are the DEFAULT dates. The admin app's Season document (packages/db) can override
 * them (force-freeze, early close). Server code should consult the DB first and fall back
 * to these helpers.
 */

/** Spirit O Santa operates from Storm Lake, Iowa. */
export const SEASON_TIME_ZONE = "America/Chicago";

/** month is 1-12 (human style, NOT JS's 0-11). */
export const SEASON_CALENDAR = {
  open: { month: 10, day: 1 }, // families earn & build lists
  freeze: { month: 12, day: 1 }, // wish lists frozen
  close: { month: 12, day: 25 }, // season over, unfunded-item handling
  reset: { month: 1, day: 1 }, // points reset to zero
  storeWindowStart: { month: 1, day: 1 }, // stores may edit item lists...
  storeWindowEnd: { month: 3, day: 31 }, // ...through Mar 31 (locked Apr 1)
} as const;

export type SeasonPhase = "offseason" | "open" | "frozen" | "closed";

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// Intl formatters are relatively expensive to build; cache one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-calendar date of instant `at` in `timeZone`. */
export function calendarDateIn(
  at: Date,
  timeZone = SEASON_TIME_ZONE,
): CalendarDate {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(
    fmt.formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** Sortable month/day key: Oct 1 → 1001, Dec 25 → 1225. */
const key = (d: { month: number; day: number }) => d.month * 100 + d.day;

/** Which phase of the season `at` falls in (default calendar). */
export function getSeasonPhase(at: Date = new Date()): SeasonPhase {
  const k = key(calendarDateIn(at));
  const c = SEASON_CALENDAR;
  if (k >= key(c.close)) return "closed"; // Dec 25-31
  if (k >= key(c.freeze)) return "frozen"; // Dec 1-24
  if (k >= key(c.open)) return "open"; // Oct 1 - Nov 30
  return "offseason"; // Jan 1 - Sep 30
}

/** True while stores may add/edit/price items (Jan 1 – Mar 31). */
export function isStoreItemWindowOpen(at: Date = new Date()): boolean {
  const k = key(calendarDateIn(at));
  return (
    k >= key(SEASON_CALENDAR.storeWindowStart) &&
    k <= key(SEASON_CALENDAR.storeWindowEnd)
  );
}

/**
 * The Christmas a date belongs to. Jan-Dec of year Y all prepare for Christmas Y
 * (the Jan 1 reset starts the next cycle), so this is the calendar year in the season zone.
 */
export function getSeasonYear(at: Date = new Date()): number {
  return calendarDateIn(at).year;
}
