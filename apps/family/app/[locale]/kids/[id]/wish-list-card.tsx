/**
 * "My wish list" on the kid page (Phase 6 slice 2). Server component: rows come from
 * kidWishList (funding order = the order new points fill them). Progress is a native
 * <progress> element (screen readers announce it). "Remove (parent)" goes to a PIN page.
 * SURPRISE gifts (owner 2026-11-08) arrive already masked by kidWishList (no name/photo/store/id): they show the
 * swappable wrapped-gift illustration and "A surprise!" instead, and no link to the gift page.
 */
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { formatPoints } from "@repo/lib/format";
import type { KidWishList } from "@repo/wishlists/catalog";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { MagicBar } from "../../../../components/magic-bar";
import { buttonClass } from "@repo/ui/button";
import { ILLUSTRATIONS } from "@/lib/illustrations";

export async function WishListCard({ kidId, registered, cap, list }: { kidId: string; registered: boolean; cap: number; list: KidWishList }) {
  const t = await getTranslations("Gifts");
  return (
    <Card className="mb-6">
      <div id="wishlist" className="mb-3 flex flex-wrap items-center justify-between gap-3 scroll-mt-6">
        <div>
          <h2 className="text-lg font-semibold">{t("listTitle")}</h2>
          <p className="text-sm text-muted" data-testid="wish-count">{t("listCount", { count: list.onList, cap })}</p>
        </div>
        {registered && list.seasonOpen && (
          <Link href={`/kids/${kidId}/gifts`} className={buttonClass()}>
            {t("browse")}
          </Link>
        )}
      </div>
      {!list.seasonOpen && list.rows.length > 0 && <p className="mb-3 text-sm">{t("frozen")}</p>}
      {list.rows.length === 0 ? (
        <p className="text-muted">{t("listEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-foreground/10" data-testid="wish-list">
          {list.rows.map((w) => (
            <li key={w.id} className="flex gap-4 py-4" data-wish-status={w.status} data-surprise={w.surprise || undefined}>
              {w.surprise ? (
                // eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG; next/image adds nothing
                <img src={ILLUSTRATIONS.giftBox} alt="" width={96} height={72} className="aspect-[4/3] h-18 w-24 shrink-0 rounded-2xl bg-foreground/5 object-contain p-2" />
              ) : w.photoUrl ? (
                <Image src={w.photoUrl} alt={t("photoAlt", { name: w.name })} width={96} height={72} className="aspect-[4/3] h-18 w-24 shrink-0 rounded-2xl object-cover" />
              ) : (
                <div className="aspect-[4/3] h-18 w-24 shrink-0 rounded-2xl bg-foreground/5" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {w.surprise ? (
                  <p className="font-semibold">{t("surpriseTitle")}</p>
                ) : w.viewable ? (
                  <Link href={`/kids/${kidId}/gifts/${w.itemId}`} className="font-semibold underline-offset-4 hover:underline">
                    {w.name}
                  </Link>
                ) : (
                  <p className="font-semibold">{w.name}</p>
                )}
                <p className="text-sm text-muted">
                  {w.surprise ? t("surpriseNote") : t("fromStore", { store: w.storeName })} · {t(`status.${w.status}` as never)}
                </p>
                {/* Same words for the bar's screen-reader text and the visible line under it. */}
                <MagicBar value={w.fundedCentipoints} max={w.costCentipoints} label={t("progressLabel", { name: w.surprise ? t("surpriseName") : w.name })} valueText={t("progress", { funded: formatPoints(w.fundedCentipoints), cost: formatPoints(w.costCentipoints) })} />
                <p className="text-sm font-bold">{t("progress", { funded: formatPoints(w.fundedCentipoints), cost: formatPoints(w.costCentipoints) })}</p>
                {/* Fully funded = secured (owner 2026-11-07): held by the store, shipped in the December window. */}
                {(w.status === "fully_funded" || w.status === "locked") && !w.needsSubstitute && <p className="text-sm text-muted" data-testid="secured">{t("secured")}</p>}
                {w.needsSubstitute && <p className="text-sm">{t("needsSubstitute")}</p>}
                {w.removable && (
                  <Link href={`/kids/${kidId}/wishlist/${w.id}/remove`} className="self-start text-sm underline underline-offset-4">
                    {t("remove")}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {registered && list.seasonOpen && <p className="mt-3 text-sm text-muted">{t("shareHint")}</p>}
      {/* Parent-only page behind the PIN (owner 2026-11-08); the words don't say WHAT the surprise is. */}
      {registered && list.seasonOpen && (
        <Link href={`/kids/${kidId}/surprise`} className="mt-2 inline-block text-sm underline underline-offset-4" data-testid="surprise-link">
          {t("surpriseAdd")}
        </Link>
      )}
    </Card>
  );
}
