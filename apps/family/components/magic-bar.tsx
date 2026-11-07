/**
 * Family funding bar: the shared @repo/ui ProgressBar in its "magic" tone (gold while collecting,
 * evergreen when complete, fill + shine animation from magic.css). `valueText` = the text shown under
 * it, so screen readers hear the same words (review 2026-11-06).
 */
import { ProgressBar } from "@repo/ui/progress-bar";

export function MagicBar({ value, max, label, valueText }: { value: number; max: number; label: string; valueText: string }) {
  return <ProgressBar value={value} max={max} label={label} valueText={valueText} tone="magic" size="thick" animated className="w-full" />;
}
