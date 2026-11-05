/**
 * Translations OUTSIDE a page render: SMS (Twilio), push (FCM), emails, background jobs.
 * Pass the recipient's saved locale (User.locale / Deed.locale); unknown values fall
 * back to English instead of throwing, so a bad DB value can't block a notification.
 *
 *   const t = await getCommonTranslator(user.locale, "Common");
 *   await sendSms(phone, t("brand"));
 */
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { SEASON_TIME_ZONE } from "@repo/lib/season";
import { loadCommonMessages } from "./messages.ts";

export async function getCommonTranslator(locale: unknown, namespace?: string) {
  const safe = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = await loadCommonMessages(safe);
  // Loosely typed on purpose: this helper serves every app's notification strings.
  return createTranslator({
    locale: safe,
    messages,
    namespace,
    timeZone: SEASON_TIME_ZONE,
  } as Parameters<typeof createTranslator>[0]);
}
