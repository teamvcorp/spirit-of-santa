/**
 * Top bar shared by all apps. Slots instead of imports keep this package free of app
 * concerns: each app passes its own locale-aware brand link and actions (language
 * switcher, account menu).
 */
import type { ReactNode } from "react";

export function SiteHeader({ brand, actions }: { brand: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/15 px-4 py-3">
      <div className="text-lg font-bold">{brand}</div>
      {actions && <div className="flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
    </header>
  );
}
