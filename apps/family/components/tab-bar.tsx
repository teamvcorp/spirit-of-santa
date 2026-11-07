"use client";
/**
 * Bottom tab bar for the family device (Phase 8.5, owner's choice: "bottom tab bar").
 * Home · Wish list · Gifts · Parent. "Wish list" and "Gifts" belong to a child: on a child's pages
 * they go to THAT child's list / gift browser; elsewhere they lead home to pick a child.
 * Shown only to a signed-in family (FamilyTabs decides); visitors' pages never get it.
 * Big touch targets (≥ 56 px), labels under icons, aria-current on the active tab.
 */
import { Link, usePathname } from "@/i18n/navigation";
import { kidPath } from "@/lib/kid-path";

type Labels = { home: string; wishlist: string; gifts: string; parent: string; nav: string };

const icon = {
  home: <path d="M3 11l9-7 9 7M5 10v10h14V10" />,
  wishlist: <path d="M12 21s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" />,
  gifts: (
    <>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1" />
    </>
  ),
  parent: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export function TabBar({ labels }: { labels: Labels }) {
  const path = usePathname();
  const at = kidPath(path);
  const kid = at?.kidId;
  const onGifts = at?.section === "gifts";
  const tabs = [
    { key: "home", href: "/", active: path === "/" },
    { key: "wishlist", href: kid ? `/kids/${kid}` : "/", active: Boolean(kid) && !onGifts },
    { key: "gifts", href: kid ? `/kids/${kid}/gifts` : "/", active: onGifts },
    { key: "parent", href: "/parent", active: path.startsWith("/parent") },
  ] as const;
  return (
    <>
      {/* Keeps the last bit of each page (and the footer) above the fixed bar. */}
      <div aria-hidden="true" className="h-24" />
      <nav aria-label={labels.nav} className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ul className="mx-auto grid max-w-md grid-cols-4 gap-1 rounded-[26px] border border-foreground/15 bg-surface/95 p-1.5 shadow-card backdrop-blur">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={t.active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[20px] text-xs font-bold no-underline ${t.active ? "bg-primary text-on-primary" : "text-muted hover:bg-foreground/5"}`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {icon[t.key]}
                </svg>
                {labels[t.key]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
