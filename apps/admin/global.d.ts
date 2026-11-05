/**
 * Type-safe translations: t("HomePage.title") is checked against the English files,
 * so a typo in a message key is a type error instead of a blank string at runtime.
 */
import type { Locale } from "@repo/lib/locales";
import type common from "@repo/i18n/messages/en.json";
import type messages from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof common & typeof messages;
  }
}
