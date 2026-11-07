/**
 * Funding / progress bar: the ONE implementation for every app (review 2026-11-06: the store and
 * family apps each had their own, with different ARIA). Server- and client-safe (no hooks).
 *
 * Accessible: role=progressbar reports a clamped PERCENT (0–100) and `valueText` = exactly what
 * the page prints (e.g. "15 of 25 Christmas Magic"), so screen readers never hear internal units.
 * The caller always prints the numbers as text too (colour/animation never carry meaning alone).
 *  - tone "meter": one hue (bg-meter on a 20% track): calm dashboards (store).
 *  - tone "magic": gold while collecting, evergreen when complete (family). `animated` adds the fill
 *    + shine classes from the family app's magic.css (no effect where that CSS isn't loaded; off for
 *    reduced motion).
 */
import { cn } from "./cn.ts";

export function ProgressBar({
  value,
  max,
  label,
  valueText,
  tone = "meter",
  size = "thin",
  animated = false,
  className,
}: {
  value: number;
  max: number;
  label: string;
  valueText?: string;
  tone?: "meter" | "magic";
  size?: "thin" | "thick";
  animated?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const done = pct >= 100;
  const fill = tone === "meter" || done ? "bg-meter" : "bg-gradient-to-r from-gold to-gold-light";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(pct)}
      aria-valuetext={valueText}
      className={cn("relative overflow-hidden rounded-full", tone === "meter" ? "bg-meter/20" : "bg-foreground/10", size === "thin" ? "h-2" : "h-3.5", className)}
    >
      {pct > 0 && (
        <div className={cn("absolute inset-y-0 left-0 overflow-hidden rounded-full", fill, animated && "sos-bar")} style={{ width: `${pct}%` }}>
          {animated && !done && <span aria-hidden="true" className="sos-shine" />}
        </div>
      )}
    </div>
  );
}
