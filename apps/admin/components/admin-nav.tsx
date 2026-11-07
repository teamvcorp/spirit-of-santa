"use client";
/**
 * Admin section links (Phase 8.5.3): one row under the header that scrolls sideways on a phone
 * (instead of wrapping into three lines), with the current section highlighted (aria-current).
 * Rendered only for a signed-in admin (AdminNavGate); the sign-in page stays clean.
 */
import { Link, usePathname } from "@/i18n/navigation";
import { ADMIN_SECTIONS, type AdminSection } from "@/lib/sections";


export function AdminNav({ label, names }: { label: string; names: Record<AdminSection, string> }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap py-1.5">
        {ADMIN_SECTIONS.map((s) => {
          const current = path === `/${s}` || path.startsWith(`/${s}/`);
          return (
            <li key={s}>
              <Link
                href={`/${s}`}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full px-3.5 text-sm font-bold no-underline ${current ? "bg-primary text-on-primary" : "text-foreground hover:bg-foreground/10"}`}
              >
                {names[s]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
