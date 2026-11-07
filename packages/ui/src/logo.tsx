/**
 * Spirit of Santa logo (owner's artwork, 2026-11-07). Every header in all three apps uses this ONE component.
 *
 * The badge is a static SVG file (packages/ui/assets/logo.svg, built from the designer's original by
 * scripts/brand/build-logo.mjs). It's IMPORTED, not inlined: Next copies it to /_next/static/media/<hash>.svg, so
 * browsers download it once and cache it for good (a new logo gets a new hash), instead of ~70 KB of drawing in
 * every page's HTML. It's an <img> with alt="" because the visible wordmark beside it is the accessible name.
 *
 * To change the logo: replace packages/ui/assets/logo-source.svg and run `npm run brand:logo`.
 */
import logo from "../assets/logo.svg";
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
