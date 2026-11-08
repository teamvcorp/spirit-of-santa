/**
 * Spirit of Santa logo. Every header in all three apps uses this ONE component.
 *
 * Owner's artwork 2026-11-08: the header shows the SIMPLE badge (gift + bow, no lettering), because the designer's
 * rule is "simple badge under 96 px" and the header draws it at 48–56 px, where ring lettering is unreadable. The
 * full seal ("North Pole Approved") is used at large sizes (link-preview picture).
 *
 * The badge is a static SVG file (packages/ui/assets/logo-icon.svg, built from the designer's file by
 * scripts/brand/build-logo.mjs). It's IMPORTED, not inlined: Next copies it to /_next/static/media/<hash>.svg, so
 * browsers download it once and cache it for good (a new logo gets a new hash), instead of repeating the drawing in
 * every page's HTML. It's an <img> with alt="" because the visible wordmark beside it is the accessible name.
 *
 * To change the logo: replace a file in packages/ui/assets/source/ and run `npm run brand:logo` (docs/brand.md).
 */
import logo from "../assets/logo-icon.svg";
import { cn } from "./cn.ts";

export function LogoMark({ className }: { className?: string }) {
  return (
    // A plain <img>, not next/image: SVGs aren't resized by the image optimiser anyway, and this keeps the
    // shared package free of image-loader config. width/height reserve the space (no layout jump).
    <img src={logo.src} width={56} height={56} alt="" decoding="async" className={cn("size-12 sm:size-14", className)} />
  );
}

/** Badge + "Spirit of Santa" wordmark (the visible text is the accessible name). */
export function Logo({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3 font-display text-xl font-bold tracking-tight", className)}>
      <LogoMark />
      <span>{label}</span>
    </span>
  );
}
