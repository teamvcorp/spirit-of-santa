/**
 * Funding progress bar (Phase 8.5): gold while collecting, evergreen when complete; it fills up
 * once and a soft shine passes over unfinished bars (magic.css; off for reduced motion).
 * Accessible: a real progressbar with min/max/now + label; the numbers are ALSO printed as text by
 * the caller (colour/animation never carry the information alone).
 */
export function MagicBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const done = pct >= 100;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="relative h-3.5 w-full overflow-hidden rounded-full bg-foreground/10">
      <div
        className={`sos-bar absolute inset-y-0 left-0 overflow-hidden rounded-full ${done ? "bg-meter" : "bg-gradient-to-r from-gold to-gold-light"}`}
        style={{ width: `${pct}%` }}
      >
        {!done && pct > 0 && <span aria-hidden="true" className="sos-shine" />}
      </div>
    </div>
  );
}
