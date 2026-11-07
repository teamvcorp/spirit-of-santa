/**
 * Supported UI languages. Client-safe. The single source of truth: the DB `locale`
 * enums, next-intl routing and the message-parity test all read this list.
 * Adding a language = add it here + add messages/<code>.json in packages/i18n and each app.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name written in that language (what a language switcher shows). */
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", es: "Español" };

/** Type guard. Use it on anything from a URL, cookie or form before trusting it. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Our locale → the Intl tag for numbers/dates (US formats in both languages). The ONE mapping. */
export function intlLocale(locale: unknown): "en-US" | "es-US" {
  return locale === "es" ? "es-US" : "en-US";
}
