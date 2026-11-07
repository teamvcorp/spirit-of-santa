/**
 * Display formatting. CLIENT-SAFE: no conversion rates live here, only presentation of
 * values the server already computed.
 */
import { intlLocale } from "./locales.ts";
import { SEASON_TIME_ZONE } from "./season.ts";

/** 333 → "3.33", 100 → "1", 150 → "1.5". Trailing zeros dropped for kid-friendly display. */
export function formatPoints(centipoints: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    centipoints / 100,
  );
}

/** 1050 → "$10.50". Use for any USD shown to users. */
export function formatCents(cents: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Largest item price we accept: $10,000 (a typo guard; kids' gifts are far below this). */
export const MAX_PRICE_CENTS = 1_000_000;

/**
 * Parse a dollar amount typed by a person ("29.99", "30", "$1,299.50") into integer cents,
 * WITHOUT floating-point maths (29.99 * 100 = 2998.9999… in floats). null if invalid.
 * Accepts an optional "$", thousands commas, and up to 2 decimals.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 2999 → "29.99" for pre-filling a price input (no currency symbol, always 2 decimals). */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
/**
 * "December 17" / "17 de diciembre" in the season's time zone (America/Chicago): the ONE way dates
 * are written in emails and season messages. `style: "long"` adds the year (receipts).
 */
export function formatLongDate(d: Date, locale: unknown, style: "dayMonth" | "long" = "dayMonth"): string {
  const opts: Intl.DateTimeFormatOptions = style === "long" ? { dateStyle: "long" } : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: SEASON_TIME_ZONE }).format(d);
}
