/**
 * Season calendar. CLIENT-SAFE.
 *
 * Every date rule is evaluated in ONE time zone, so "Dec 1 freeze" happens at the same
 * instant for every user and server (Vercel servers run in UTC; without this, the freeze
 * would hit at 6 pm Nov 30 for Iowa families).
 *
 * These are the DEFAULT dates. The admin app's Season document (packages/db) can override
 * them (force-freeze, freeze/close dates). Server code should consult the DB first and fall back
 * to these helpers.
 *
 * YEAR-ROUND (owner decision 2026-11-07, plan: docs/plans/year-round-season.md):
 *   Jan 1 - Nov 30  OPEN     families earn Christmas Magic and build/change wish lists
 *   Dec 1 - Dec 25  FROZEN   lists fixed, last pushes, stores ship (by Dec 10)
 *   Dec 26 - Dec 31 CLOSED   (first closed day = "close")
 *   Jan 1           RESET    last season's unspent magic goes to Spirit of Santa; until that reset is done the
 *                            phase is "resetting" (nothing earns), then the new season is open.
 * Stores add/change merchandise only Jan 1 - Mar 31 (store item window); after that items are fixed.
 */
import { PAY_UP_DAYS } from "./limits.ts";

/** Spirit of Santa operates from Storm Lake, Iowa. */
export const SEASON_TIME_ZONE = "America/Chicago";

/** month is 1-12 (human style, NOT JS's 0-11). */
export const SEASON_CALENDAR = {
  open: { month: 1, day: 1 }, // families earn & build lists ALL YEAR (fixed: not admin-editable)
  freeze: { month: 12, day: 1 }, // wish lists frozen
  close: { month: 12, day: 26 }, // FIRST CLOSED DAY (the season's last day is Dec 25); unfunded-item handling
  reset: { month: 1, day: 1 }, // points reset to zero, then the new season opens
  shipBy: { month: 12, day: 10 }, // stores' last ship day so gifts arrive by Christmas
  storeWindowStart: { month: 1, day: 1 }, // stores may edit item lists...
  storeWindowEnd: { month: 3, day: 31 }, // ...through Mar 31 (locked Apr 1)
} as const;

/** "resetting" = Jan 1 until last season's reset is done (nothing can earn or change). */
export type SeasonPhase = "resetting" | "open" | "frozen" | "closed";

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

/** Which phase of the season `at` falls in (default calendar; can't see the reset gate: getSeasonState can). */
export function getSeasonPhase(at: Date = new Date()): SeasonPhase {
  const k = key(calendarDateIn(at));
  const c = SEASON_CALENDAR;
  if (k >= key(c.close)) return "closed"; // Dec 26-31
  if (k >= key(c.freeze)) return "frozen"; // Dec 1-25
  return "open"; // Jan 1 - Nov 30
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

// ── Admin overrides (Phase 3 slice 2) ──────────────────────────────────────────────────
/*
 * The admin app can change a season's open / freeze / close DATES (only before that season
 * opens: user decision 2026-11-05), switch the store item window, and force the freeze.
 * Dates are stored as calendar days "YYYY-MM-DD" in SEASON_TIME_ZONE (not timestamps), exactly
 * like the defaults above: "Dec 1" means midnight Chicago time, no daylight-saving maths.
 * resolveSeason() is THE rule book; servers load the Season document and pass it in
 * (packages/stores/src/season.ts → getSeasonState()).
 */

export type StoreWindowMode = "auto" | "open" | "closed";
export type SeasonOverrides = {
  /** IGNORED since the year-round calendar (open is always Jan 1); kept so old Season documents still parse. */
  openDate?: string | null;
  freezeDate?: string | null;
  closeDate?: string | null;
  forceFrozen?: boolean | null;
  storeWindow?: StoreWindowMode | null;
  /** false = LAST season's Jan 1 reset hasn't finished yet, so the phase is "resetting". Absent/true = done. */
  prevResetDone?: boolean | null;
};

export type SeasonState = {
  year: number;
  phase: SeasonPhase;
  /** "forced" = the admin force-freeze switch made it frozen. */
  phaseSource: "calendar" | "custom" | "forced";
  /** Effective dates (custom or default), "YYYY-MM-DD". close = FIRST closed day. */
  dates: { open: string; freeze: string; close: string };
  /** Stores' last ship day ("YYYY-MM-DD") so gifts arrive by Christmas. */
  shipBy: string;
  /**
   * THIS season's December ship window. Gifts lock (magic spent) as soon as they're fully funded and are
   * HELD by the store until `from` (the freeze date, admin changes included). open = today >= from. It stays
   * open after Dec 25 (a late gift beats none) and LAST season's gifts may always ship: use canShipGift().
   */
  shipping: { open: boolean; from: string; by: string };
  /** True once this season's freeze date is reached: its dates can't change any more. */
  datesLocked: boolean;
  forceFrozen: boolean;
  storeWindowOpen: boolean;
  storeWindowMode: StoreWindowMode;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" for a calendar date. */
export const isoDay = (d: CalendarDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** Parse "YYYY-MM-DD" (must be a real day: no Feb 30). null if not. */
export function parseIsoDay(s: string): CalendarDate | null {
  const m = ISO_DAY.exec(s);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** The default dates for a season year. */
export function defaultSeasonDates(year: number) {
  const c = SEASON_CALENDAR;
  return {
    open: isoDay({ year, ...c.open }),
    freeze: isoDay({ year, ...c.freeze }),
    close: isoDay({ year, ...c.close }),
  };
}

/** Stores' last ship day for a season year. */
export const shipByDate = (year: number) => isoDay({ year, ...SEASON_CALENDAR.shipBy });

/** Phase, store window and lock state at `at`, with the admin overrides applied. */
export function resolveSeason(at: Date = new Date(), o: SeasonOverrides = {}): SeasonState {
  const today = isoDay(calendarDateIn(at)); // "YYYY-MM-DD" strings compare correctly as text
  const year = getSeasonYear(at);
  const def = defaultSeasonDates(year);
  // Open is always Jan 1 (an old openDate override is ignored).
  const dates = { open: def.open, freeze: o.freezeDate || def.freeze, close: o.closeDate || def.close };
  const custom = Boolean(o.freezeDate || o.closeDate);
  let phase: SeasonPhase =
    today >= dates.close ? "closed" : o.prevResetDone === false ? "resetting" : today >= dates.freeze ? "frozen" : "open";
  let phaseSource: SeasonState["phaseSource"] = custom ? "custom" : "calendar";
  const forceFrozen = o.forceFrozen === true;
  // Force-freeze only changes an OPEN season (after the freeze date it's frozen or closed anyway). NOTE: a
  // force-freeze must never trigger date-based jobs (donation split, pay-up): those check the freeze DATE.
  if (forceFrozen && phase === "open") {
    phase = "frozen";
    phaseSource = "forced";
  }
  const mode: StoreWindowMode = o.storeWindow === "open" || o.storeWindow === "closed" ? o.storeWindow : "auto";
  return {
    year,
    phase,
    phaseSource,
    dates,
    shipBy: shipByDate(year),
    shipping: { open: today >= dates.freeze, from: dates.freeze, by: shipByDate(year) },
    datesLocked: today >= dates.freeze,
    forceFrozen,
    storeWindowOpen: mode === "open" ? true : mode === "closed" ? false : isStoreItemWindowOpen(at),
    storeWindowMode: mode,
  };
}

/**
 * May a store ship a LOCKED gift of season `giftSeasonYear` now? Decided PER GIFT (year-round critique):
 * an older season's gift is always shippable (never held another 11 months after Christmas); this
 * season's only once its December window opens. The ONE rule for the store pages, counts, digest and markShipped.
 */
export function canShipGift(giftSeasonYear: number, s: Pick<SeasonState, "year" | "shipping">): boolean {
  return giftSeasonYear < s.year || (giftSeasonYear === s.year && s.shipping.open);
}

/**
 * Is a gift that's ready to ship now LATE (ask the store for "as soon as possible", not "by Dec 10")?
 * True once this season's ship-by day is over, and outside this season's window (then every ready gift is
 * last season's). The ONE rule for the store Orders page and the store digest email.
 */
export function shipLate(s: Pick<SeasonState, "shipping">, at: Date = new Date()): boolean {
  return !s.shipping.open || at.getTime() >= startOfDayInZone(s.shipping.by).getTime() + 86_400_000;
}

/**
 * Pay-up period of a season (pure; @repo/wishlists/payup uses it): opens at the START of the freeze date and
 * closes PAY_UP_DAYS later (closesAt = start of the first day without pay-ups; lastPayDay = the instant before,
 * shown as "until December 3"). Unfinished gifts drop off at closesAt (closeUnfunded).
 */
export function payUpPeriod(dates: { freeze: string }): { opensAt: Date; closesAt: Date; lastPayDay: Date } {
  const opensAt = startOfDayInZone(dates.freeze);
  // Calendar days (not 72 h), so a time-zone shift can never move the close off midnight.
  const [y, m, d] = dates.freeze.split("-").map(Number) as [number, number, number];
  const closeDay = new Date(Date.UTC(y, m - 1, d + PAY_UP_DAYS));
  const closesAt = startOfDayInZone(isoDay({ year: closeDay.getUTCFullYear(), month: closeDay.getUTCMonth() + 1, day: closeDay.getUTCDate() }));
  return { opensAt, closesAt, lastPayDay: new Date(closesAt.getTime() - 1) };
}

/** The newest season whose gifts may ship now (for database filters: `seasonYear <= newestShippableYear`). */
export const newestShippableYear = (s: Pick<SeasonState, "year" | "shipping">) => (s.shipping.open ? s.year : s.year - 1);

export type SeasonDatesError = "invalidDate" | "wrongYear" | "freezeRange" | "closeRange" | "freezeTooSoon" | "locked";

/** A changed freeze date must be at least this many days away (the cutoff reminder goes out 3 days before). */
export const FREEZE_CHANGE_MIN_DAYS = 7;

/**
 * Check an admin's new dates for season `year` (blank = default). Rules (year-round calendar):
 *  - real days inside that year; open is fixed (Jan 1);
 *  - freeze between Nov 1 and Dec 3 (stores need time to ship by Dec 10, pay-up needs days before that);
 *  - close (FIRST closed day) between Dec 26 and Dec 31: Christmas Day always stays in the season;
 *  - locked once this season's current freeze date is reached; a CHANGED freeze date must be at least
 *    FREEZE_CHANGE_MIN_DAYS away (families may already have been told the old date).
 */
export function validateSeasonDates(
  year: number,
  input: { freezeDate?: string | null; closeDate?: string | null },
  current: SeasonOverrides,
  at: Date = new Date(),
): SeasonDatesError | null {
  const def = defaultSeasonDates(year);
  const today = isoDay(calendarDateIn(at));
  if (today >= (current.freezeDate || def.freeze)) return "locked";
  for (const v of [input.freezeDate, input.closeDate]) {
    if (!v) continue;
    const d = parseIsoDay(v);
    if (!d) return "invalidDate";
    if (d.year !== year) return "wrongYear";
  }
  const freeze = input.freezeDate || def.freeze;
  const close = input.closeDate || def.close;
  if (freeze < `${year}-11-01` || freeze > `${year}-12-03`) return "freezeRange";
  if (close < `${year}-12-26` || close > `${year}-12-31`) return "closeRange";
  if (freeze !== (current.freezeDate || def.freeze)) {
    const soonest = isoDay(calendarDateIn(new Date(at.getTime() + FREEZE_CHANGE_MIN_DAYS * 86_400_000)));
    if (freeze < soonest) return "freezeTooSoon";
  }
  return null;
}

/**
 * The instant a calendar day ("YYYY-MM-DD") begins at midnight in `timeZone` (DST-safe).
 * Used for "today" limits and for season-close deadlines (e.g. a QR code must not outlive the season).
 */
export function startOfDayInZone(isoDayStr: string, timeZone = SEASON_TIME_ZONE): Date {
  const d = parseIsoDay(isoDayStr);
  if (!d) throw new RangeError("not a YYYY-MM-DD day");
  const target = Date.UTC(d.year, d.month - 1, d.day);
  // Guess UTC midnight, see what wall-clock time that is in the zone, correct by the difference.
  // Two passes handle a daylight-saving change between the guess and the answer.
  let t = target;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    t += target - wall;
  }
  return new Date(t);
}

/**
 * Santa's Naughty/Nice list year for a calendar day (user decision 2026-11-06): voting runs all
 * year, and each list covers Dec 26 → Dec 25 (Central Time). Christmas Day ends a list; from
 * Dec 26 votes build NEXT Christmas's list. "2026-12-25" → 2026, "2026-12-26" → 2027.
 */
export function santaListYear(isoDayStr: string): number {
  const year = Number(isoDayStr.slice(0, 4));
  return isoDayStr.slice(5) > "12-25" ? year + 1 : year;
}

/** First day of a list year: Dec 26 of the year before ("2027" → "2026-12-26"). */
export const santaListStart = (listYear: number) => `${listYear - 1}-12-26`;
