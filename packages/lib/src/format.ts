/**
 * Display formatting. CLIENT-SAFE: no conversion rates live here, only presentation of
 * values the server already computed.
 */

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
