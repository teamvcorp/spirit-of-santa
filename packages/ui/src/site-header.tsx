/**
 * Top bar shared by all apps. Slots instead of imports keep this package free of app
 * concerns: each app passes its own locale-aware brand link and actions (language
 * switcher, account menu).
 * Winter Night (Phase 8.5): always the night-blue bar (in both modes). Instead of restyling every
 * component placed inside, the bar RE-SCOPES the theme variables: within it "foreground" is snow
 * white, "muted" is light blue-grey and the focus ring is gold, so the account menu, language
 * switcher and sign-out button stay readable automatically (contrast 13.6:1 / 8.6:1 / 10.6:1).
 */
import type { CSSProperties, ReactNode } from "react";

const NIGHT_SCOPE = {
  "--foreground": "#f8fafc",
  "--muted": "#b8c4db",
  "--focus": "#f5c451",
} as CSSProperties;

export function SiteHeader({ brand, actions }: { brand: ReactNode; actions?: ReactNode }) {
  return (
    <header style={NIGHT_SCOPE} className="flex flex-wrap items-center justify-between gap-4 bg-night px-4 py-3 text-foreground">
      <div>{brand}</div>
      {actions && <div className="flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
    </header>
  );
}
