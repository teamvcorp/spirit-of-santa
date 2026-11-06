/**
 * Engagement display pieces (Phase 2 slice 5). Server components: no client JS.
 *
 * Design rules (dataviz guide): a stat tile is just a label + a value (no deltas: totals only
 * for now, user decision 2026-11-05). The funding meter is ONE hue: the fill is `meter`, the
 * unfilled track the same hue at 20%, and the percentage is always printed as text beside it,
 * so nothing relies on colour alone. 0% draws no fill at all. Colours: packages/ui/src/theme.css.
 */
import { getFormatter, getTranslations } from "next-intl/server";
import type { ItemStats } from "@repo/stores/items";

/** Thin funding bar + its percentage as text. `label` names it for screen readers. */
export function FundingMeter({ percent, label }: { percent: number; label: string }) {
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-meter/20">
        {p > 0 && <div className="h-full rounded-full bg-meter" style={{ width: `${p}%` }} />}
      </div>
      <span className="text-sm tabular-nums">{p}%</span>
    </div>
  );
}

/** The KPI row: views, on lists, fully funded, locked in, funding %. */
export async function EngagementTiles({ stats, className = "" }: { stats: ItemStats; className?: string }) {
  const [t, format] = await Promise.all([getTranslations("Items"), getFormatter()]);
  const n = (v: number) => format.number(v);
  const tiles = [
    { key: "views", label: t("statViews"), value: n(stats.views) },
    { key: "onLists", label: t("statOnLists"), value: n(stats.onLists) },
    { key: "fullyFunded", label: t("statFullyFunded"), value: n(stats.fullyFunded) },
    { key: "locked", label: t("statLocked"), value: n(stats.locked) },
  ];
  return (
    <div className={className}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-lg border border-foreground/15 p-3">
            <dt className="text-sm text-foreground/70">{tile.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{tile.value}</dd>
          </div>
        ))}
        <div className="col-span-2 rounded-lg border border-foreground/15 p-3 sm:col-span-1">
          <dt className="text-sm text-foreground/70">{t("statFunding")}</dt>
          <dd className="mt-2">
            <FundingMeter percent={stats.fundingPercent} label={t("statFunding")} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-foreground/70">{t("engagementNote")}</p>
    </div>
  );
}
