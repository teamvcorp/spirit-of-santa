"use client";
/**
 * Language switcher shared by all apps. Plain links to the explicitly prefixed URL
 * (/en/..., /es/...): the proxy saves the choice in the locale cookie and, for English,
 * redirects to the prefix-less URL. A full page load is fine for a language change.
 *
 * variant "links" (store, admin): the current language as bold text, the other as a link.
 * variant "pill" (family themes, 2026-11-08): both in one rounded pill, the current one filled gold, so it no longer
 * looks like one is a link and the other isn't. Same behaviour and markup (links + aria-current), only the look.
 * The pill is drawn on the night/evergreen header, so its colours are the header's (cream, gold, night text).
 */
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALE_LABELS, LOCALES } from "@repo/lib/locales";
import { switchLocalePath } from "./paths.ts";

export function LocaleSwitcher({ label, className, variant = "links" }: { label: string; className?: string; variant?: "links" | "pill" }) {
  const pathname = usePathname() ?? "/";
  const current = useLocale();
  const pill = variant === "pill";
  return (
    <nav aria-label={label} className={className}>
      <ul className={pill ? "flex rounded-full border border-[#fff8e7]/25 bg-[#fff8e7]/10 p-[3px]" : "flex gap-3"}>
        {LOCALES.map((l) => (
          <li key={l}>
            {l === current ? (
              <span
                aria-current="true"
                className={pill ? "inline-flex min-h-10 items-center rounded-full bg-[#f6d27a] px-4 font-extrabold text-[#1b2a4a]" : "font-semibold"}
              >
                {LOCALE_LABELS[l]}
              </span>
            ) : (
              <a
                href={switchLocalePath(pathname, l)}
                hrefLang={l}
                lang={l}
                className={pill ? "inline-flex min-h-10 items-center rounded-full px-4 font-bold text-[#fff8e7] no-underline hover:underline" : "underline"}
              >
                {LOCALE_LABELS[l]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
