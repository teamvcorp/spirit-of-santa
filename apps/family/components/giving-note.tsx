/**
 * The ONE small disclosure wherever people give money (owner 2026-11-07: "gifts cannot arrive after Christmas,
 * keep the disclosure small"). Giving closes at the freeze date so every gift can ship in time.
 *  - <GivingNote lastDay /> : one muted line under a giving form ("Giving closes after November 30…").
 *  - <GivingClosed />       : shown instead of the form once giving has closed (Dec 1 until the season reset).
 * Dates come from giftWindow() (@repo/stores/season): never hard-code them.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { formatLongDate } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";

export async function GivingNote({ lastDay }: { lastDay: Date }) {
  const [t, locale] = await Promise.all([getTranslations("Giving"), getLocale()]);
  return (
    <p className="text-sm text-muted" data-testid="giving-note">
      {t("note", { date: formatLongDate(lastDay, locale) })}
    </p>
  );
}

/** paused = the admin's emergency freeze (reversible): never say "opens again on January 1" then. */
export async function GivingClosed({ paused = false }: { paused?: boolean }) {
  const t = await getTranslations("Giving");
  return (
    <div data-testid="giving-closed">
      <Alert>{t(paused ? "paused" : "closed")}</Alert>
    </div>
  );
}
