/**
 * Spirit O Santa logo: PLACEHOLDER (Phase 8.5; the owner has a real logo to add later).
 *
 * TO SWAP IN THE REAL LOGO: replace the <svg> in LogoMark below with the logo's SVG (keep
 * viewBox + `aria-hidden`), or swap it for <img src="/brand/logo.svg" alt="" …> once the file is in each
 * app's public/brand folder. Every header in all three apps uses this ONE component.
 *
 * The mark is a gold coin with a night-blue star (works on night AND snow backgrounds); the
 * wordmark is the app's display serif.
 */
import { cn } from "./cn.ts";

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true" className={className}>
      {/* Colours from the theme tokens (theme.css), so a palette change reaches the logo too. */}
      <circle cx="17" cy="17" r="16" style={{ fill: "var(--color-gold)" }} />
      <path d="M17 7l2.6 6.2 6.6.5-5 4.3 1.6 6.5L17 21l-5.8 3.5 1.6-6.5-5-4.3 6.6-.5z" style={{ fill: "var(--color-night)" }} />
    </svg>
  );
}

/** Mark + "Spirit O Santa" wordmark (the visible text is the accessible name). */
export function Logo({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight", className)}>
      <LogoMark />
      <span>{label}</span>
    </span>
  );
}
