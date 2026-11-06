/**
 * US mobile numbers for pay-later texts (Phase 5 slice 4b). Pure: safe on server and client.
 * We only text US numbers (our toll-free number + carrier registration are US).
 */

/**
 * Whatever the visitor typed → E.164 "+1XXXXXXXXXX", or null. Accepts "(555) 234-5678",
 * "555.234.5678", "+1 555 234 5678", "1-555-234-5678". NANP rules: area code and exchange
 * start with 2-9 (so "123…" or "555-123-…" are refused); N11 area codes (211, 411, 911…) refused.
 */
export function toUsE164(input: string): string | null {
  if (typeof input !== "string" || input.length > 25) return null;
  if (/[^\d\s().+-]/.test(input)) return null; // letters etc.: not a phone number
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (digits[1] === "1" && digits[2] === "1") return null; // N11 service codes
  return `+1${digits}`;
}

/** "+15552345678" → "•••-•••-5678" (what we show back; never the full number). */
export function maskPhone(e164: string): string {
  return `•••-•••-${e164.slice(-4)}`;
}
