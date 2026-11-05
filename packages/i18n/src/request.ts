/**
 * Per-request next-intl config factory. Each app's i18n/request.ts calls it once.
 *
 * Messages = shared `Common` namespace (this package) + the app's own namespaces.
 * App message files must not define a top-level `Common` key (the parity test checks).
 *
 * The locale comes from `next/root-params` (the [locale] segment), which keeps pages
 * statically renderable under Cache Components. Root params are NOT available in
 * Server Actions or Route Handlers: there, call getTranslations({ locale, namespace })
 * with a locale you validated yourself (e.g. the user's saved `locale`).
 */
import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { isLocale, type Locale } from "@repo/lib/locales";
import { SEASON_TIME_ZONE } from "@repo/lib/season";
import { loadCommonMessages, type Messages } from "./messages.ts";

export function createRequestConfig(options: {
  /** `() => locale()` from "next/root-params" (typed per app, so the app passes it in). */
  readRootLocale: () => Promise<string>;
  loadAppMessages: (locale: Locale) => Promise<Messages>;
}) {
  return getRequestConfig(async ({ locale }) => {
    const candidate = locale ?? (await options.readRootLocale());
    // Never trust the URL: anything outside our list is a 404, not a file lookup.
    if (!isLocale(candidate)) notFound();

    const [common, app] = await Promise.all([
      loadCommonMessages(candidate),
      options.loadAppMessages(candidate),
    ]);
    return {
      locale: candidate,
      messages: { ...app, ...common },
      // Fixed zone so server and browser format dates the same (season rules use it too).
      timeZone: SEASON_TIME_ZONE,
    };
  });
}
