"use client";
/**
 * Admin section links (Phase 8.5.3): a row under the header (drawn HERE, so signed-out pages get no
 * empty strip) that scrolls sideways on a phone, with the current section highlighted and scrolled
 * into view. Rendered only for a signed-in admin (AdminNavGate). Uses the shared SectionNav.
 */
import { useEffect, useRef } from "react";
import { SectionNav } from "@repo/ui/section-nav";
import { Link, usePathname } from "@/i18n/navigation";
import { ADMIN_SECTIONS, type AdminSection } from "@/lib/sections";

export function AdminNav({ label, names }: { label: string; names: Record<AdminSection, string> }) {
  const path = usePathname();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // On a phone the current section may start off-screen: bring it into view (no page jump).
    row.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  const items = ADMIN_SECTIONS.map((s) => ({ key: s, href: `/${s}`, label: names[s], current: path === `/${s}` || path.startsWith(`/${s}/`) }));
  return (
    <div ref={row} className="border-t border-foreground/15">
      <SectionNav label={label} items={items} LinkComponent={Link} layout="scroll" />
    </div>
  );
}
