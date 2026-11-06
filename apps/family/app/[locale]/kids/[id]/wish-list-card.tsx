/**
 * "My wish list" on the kid page (Phase 6 slice 2). Server component: rows come from
 * kidWishList (funding order = the order new points fill them). Progress is a native
 * <progress> element (screen readers announce it). "Remove (parent)" goes to a PIN page.
 */
import Image from "next/image";
import { getFormatter, getTranslations } from "next-intl/server";
import { formatPoints } from "@repo/lib/format";
import type { KidWishList } from "@repo/wishlists/catalog";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";

export async function WishListCard({ kidId, registered, cap, list }: { kidId: string; registered: boolean; cap: number; list: KidWishList }) {
  const [t, format] = await Promise.all([getTranslations("Gifts"), getFormatter()]);
  const day = (d: Date) => format.dateTime(d, { month: "short", day: "numeric" });
  return (
    <Card className="mb-6">
      <div id="wishlist" className="mb-3 flex flex-wrap items-center justify-between gap-3 scroll-mt-6">
        <div>
          <h2 className="text-lg font-semibold">{t("listTitle")}</h2>
          <p className="text-sm text-foreground/70" data-testid="wish-count">{t("listCount", { count: list.onList, cap })}</p>
        </div>
        {registered && list.seasonOpen && (
          <Link href={`/kids/${kidId}/gifts`} className="rounded-lg bg-brand-red px-4 py-2 font-semibold text-white hover:bg-brand-red-dark">
            {t("browse")}
          </Link>
        )}
      </div>
      {!list.seasonOpen && list.rows.length > 0 && <p className="mb-3 text-sm">{t("frozen")}</p>}
      {list.rows.length === 0 ? (
        <p className="text-foreground/70">{t("listEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-foreground/10" data-testid="wish-list">
          {list.rows.map((w) => (
            <li key={w.id} className="flex gap-4 py-4" data-wish-status={w.status}>
              {w.photoUrl ? (
                <Image src={w.photoUrl} alt={t("photoAlt", { name: w.name })} width={96} height={72} className="aspect-[4/3] h-18 w-24 shrink-0 rounded object-cover" />
              ) : (
                <div className="aspect-[4/3] h-18 w-24 shrink-0 rounded bg-foreground/5" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={`/kids/${kidId}/gifts/${w.itemId}`} className="font-semibold underline-offset-4 hover:underline">
                  {w.name}
                </Link>
                <p className="text-sm text-foreground/70">
                  {t("fromStore", { store: w.storeName })} · {t(`status.${w.status}` as never)}
                </p>
                <progress className="h-2 w-full accent-brand-red" max={w.costCentipoints} value={w.fundedCentipoints} aria-label={t("progressLabel", { name: w.name })} />
                <p className="text-sm">{t("progress", { funded: formatPoints(w.fundedCentipoints), cost: formatPoints(w.costCentipoints) })}</p>
                {w.status === "fully_funded" && w.lockAt && <p className="text-sm text-foreground/70">{t("lockOn", { date: day(w.lockAt) })}</p>}
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
      {registered && list.seasonOpen && <p className="mt-3 text-sm text-foreground/70">{t("shareHint")}</p>}
    </Card>
  );
}
