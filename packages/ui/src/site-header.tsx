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

const NIGHT_SCOPE = {
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

export function SiteHeader({ brand, actions }: { brand: ReactNode; actions?: ReactNode }) {
  return (
    <header style={NIGHT_SCOPE} className="flex flex-wrap items-center justify-between gap-4 bg-night px-4 py-3 text-foreground">
      <div>{brand}</div>
      {actions && <div className="flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
    </header>
  );
}
