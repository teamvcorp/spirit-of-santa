/**
 * Pill-shaped section navigation: the ONE implementation (store dashboard, admin header row;
 * review 2026-11-06). Pure (no hooks), so it works in server and client components.
 * Pass the app's locale-aware Link as `LinkComponent`.
 *  - layout "wrap": pills wrap onto more lines (page sub-navigation).
 *  - layout "scroll": one row that scrolls sideways (header row on phones); inner padding keeps the
 *    focus ring of the first/last pill from being clipped by the scroller.
 * The current section has aria-current="page" and the primary pill colour.
 */
import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn.ts";

export type SectionNavItem = { key: string; href: string; label: string; current: boolean };

type LinkLike = ComponentType<{ href: string; className?: string; children?: ReactNode; "aria-current"?: "page" }>;

export function SectionNav({
  label,
  items,
  LinkComponent,
  layout = "wrap",
  className,
}: {
  label: string;
  items: SectionNavItem[];
  LinkComponent: LinkLike;
  layout?: "wrap" | "scroll";
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(layout === "scroll" && "overflow-x-auto [scroll-padding-inline:0.75rem]", className)}>
      <ul className={cn("flex gap-1.5", layout === "scroll" ? "whitespace-nowrap px-2 py-2" : "flex-wrap")}>
        {items.map((i) => (
          <li key={i.key}>
            <LinkComponent
              href={i.href}
              aria-current={i.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-bold no-underline",
                i.current ? "border-primary bg-primary text-on-primary" : "border-foreground/20 text-foreground hover:bg-foreground/10",
              )}
            >
              {i.label}
            </LinkComponent>
          </li>
        ))}
      </ul>
    </nav>
  );
}
