/**
 * Top bar shared by all apps. Slots instead of imports keep this package free of app
 * concerns: each app passes its own locale-aware brand link and actions (language
 * switcher, account menu).
 * Winter Night (Phase 8.5): always the night-blue bar (in both modes). Instead of restyling every
 * component placed inside, the bar RE-SCOPES the role variables to the starry-night palette (the
 * same values as dark mode, all AA on the night bar): text, muted text, focus ring, primary
 * buttons (gold), surfaces, field borders, gold text and errors. Works because the role tokens are
 * "@theme inline" in theme.css (read where used).
 */
import type { CSSProperties, ReactNode } from "react";

/**
 * Re-scope the role colours to the starry-night palette for anything drawn on a night-blue band
 * (header, the kid page's name band). Use with className="bg-night text-foreground".
 */
export const NIGHT_SCOPE = {
  "--foreground": "#f8fafc",
  "--muted": "#b8c4db",
  "--focus": "#f5c451",
  "--primary": "#e0a526",
  "--primary-hover": "#f5c451",
  "--on-primary": "#1b2a4a",
  "--surface": "#16244a",
  "--input-border": "#8fa3c7",
  "--accent-text": "#f5c451",
  "--danger": "#ff8a80",
} as CSSProperties;

/**
 * `nav` (optional, Phase 8.5.3): a second row under the brand row for section links (admin). It
 * scrolls sideways on narrow screens instead of wrapping into several lines.
 */
export function SiteHeader({ brand, actions, nav }: { brand: ReactNode; actions?: ReactNode; nav?: ReactNode }) {
  return (
    <header style={NIGHT_SCOPE} className="bg-night text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div>{brand}</div>
        {actions && <div className="flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
      </div>
      {nav && <div className="border-t border-foreground/15 px-2">{nav}</div>}
    </header>
  );
}
