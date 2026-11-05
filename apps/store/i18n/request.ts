/**
 * next-intl request config (wired up by the plugin in next.config.ts).
 * Shared logic: packages/i18n/src/request.ts. App strings: ../messages/<locale>.json.
 */
import { locale } from "next/root-params";
import { createRequestConfig } from "@repo/i18n/request";

export default createRequestConfig({
  readRootLocale: () => locale(),
  // Static map: a file path is never built from the URL.
  loadAppMessages: (l) =>
    ({
      en: () => import("../messages/en.json").then((m) => m.default),
      es: () => import("../messages/es.json").then((m) => m.default),
    })[l](),
});
