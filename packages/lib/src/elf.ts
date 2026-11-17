/**
 * "Find the elf" game (owner 2026-11-16). CLIENT-SAFE, pure (no DOM, no storage): unit-tested.
 *
 * A small elf peeks out from the edge of the kid + public pages of the family site. Each day he hides in a
 * different spot on each page (picked from the date, so everyone sees the same spot that day and it moves
 * overnight). Tapping him counts him: "You found 3 of 10 elves today!". Progress lives ONLY in the visitor's
 * browser (localStorage, apps/family/components/hidden-elf.tsx): nothing about a child is stored on a server.
 */
import { calendarDateIn } from "./season.ts";

/** Every page with an elf. Adding a page here raises the "of N" total automatically. */
export const ELF_PAGES = [
  "home",
  "donate",
  "donateThanks",
  "tip",
  "tipThanks",
  "kidLink",
  "kidLinkThanks",
  "kid",
  "gifts",
  "gift",
] as const;
export type ElfPage = (typeof ELF_PAGES)[number];

/** Where he can peek from: the left or right edge of the page, this far down it (percent of the page height). */
export type ElfSpot = { side: "left" | "right"; topPct: number };
export const ELF_SPOTS: readonly ElfSpot[] = [
  { side: "right", topPct: 14 },
  { side: "left", topPct: 26 },
  { side: "right", topPct: 41 },
  { side: "left", topPct: 55 },
  { side: "right", topPct: 68 },
  { side: "left", topPct: 82 },
];

/** Today's date in the season's time zone ("2026-11-16"), so the spot changes at local midnight. */
export function elfDay(now: Date = new Date()): string {
  // Built from formatToParts (calendarDateIn), not a locale's date format, so every browser gives the same string.
  const { year, month, day } = calendarDateIn(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Small stable hash (FNV-1a, 32-bit): same day + page → same spot for everyone. Not security-related. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The spot for this page today. */
export function elfSpot(page: ElfPage, day: string): ElfSpot {
  return ELF_SPOTS[hash(`${day}:${page}`) % ELF_SPOTS.length]!;
}

/** What we keep in the browser: the day and which pages' elves were found that day (resets every day). */
export type ElfProgress = { day: string; found: ElfPage[] };

/** Read stored progress safely: anything malformed or from another day counts as "nothing found yet". */
export function readElfProgress(raw: string | null, day: string): ElfProgress {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<ElfProgress> | null;
    if (!v || v.day !== day || !Array.isArray(v.found)) return { day, found: [] };
    const valid = new Set<string>(ELF_PAGES);
    return { day, found: [...new Set(v.found.filter((p): p is ElfPage => typeof p === "string" && valid.has(p)))] };
  } catch {
    return { day, found: [] };
  }
}

/** Count this page's elf (once per day). */
export function findElf(progress: ElfProgress, page: ElfPage): ElfProgress {
  return progress.found.includes(page) ? progress : { day: progress.day, found: [...progress.found, page] };
}
