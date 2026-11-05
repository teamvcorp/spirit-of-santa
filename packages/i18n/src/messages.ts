/** Shared message loading. Static import map (no file path is ever built from input). */
import type { Locale } from "@repo/lib/locales";

export type Messages = Record<string, unknown>;

const COMMON: Record<Locale, () => Promise<Messages>> = {
  en: () => import("../messages/en.json", { with: { type: "json" } }).then((m) => m.default),
  es: () => import("../messages/es.json", { with: { type: "json" } }).then((m) => m.default),
};

export function loadCommonMessages(locale: Locale): Promise<Messages> {
  return COMMON[locale]();
}
