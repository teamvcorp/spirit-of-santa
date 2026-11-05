"use client";
/**
 * Language switcher shared by all apps. Plain links to the explicitly prefixed URL
 * (/en/..., /es/...): the proxy saves the choice in the locale cookie and, for English,
 * redirects to the prefix-less URL. A full page load is fine for a language change.
 */
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALE_LABELS, LOCALES } from "@repo/lib/locales";
import { switchLocalePath } from "./paths.ts";

export function LocaleSwitcher({ label, className }: { label: string; className?: string }) {
  const pathname = usePathname() ?? "/";
  const current = useLocale();
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-3">
        {LOCALES.map((l) => (
          <li key={l}>
            {l === current ? (
              <span aria-current="true" className="font-semibold">
                {LOCALE_LABELS[l]}
              </span>
            ) : (
              <a href={switchLocalePath(pathname, l)} hrefLang={l} lang={l} className="underline">
                {LOCALE_LABELS[l]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
