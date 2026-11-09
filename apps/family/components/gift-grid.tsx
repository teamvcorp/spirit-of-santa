/**
 * The grid of gift cards (photo, name, store, price in Christmas Magic, sold-out tag). Shared by the kid's gift
 * browser (/kids/<id>/gifts) and the parent's surprise search (/kids/<id>/surprise, 2026-11-08); each passes where
 * a card links to. Server component: the items come from browseGifts (@repo/wishlists/catalog).
 */
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { formatPoints } from "@repo/lib/format";
import type { GiftCard } from "@repo/wishlists/catalog";
import { Link } from "@/i18n/navigation";

export async function GiftGrid({ items, hrefFor }: { items: GiftCard[]; hrefFor: (giftId: string) => string }) {
  const t = await getTranslations("Gifts");
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="gift-grid">
      {items.map((g) => (
        <li key={g.id}>
          <Link href={hrefFor(g.id)} className="flex h-full flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-surface shadow-card hover:border-accent focus-visible:border-accent">
            {g.photoUrl ? (
              <Image src={g.photoUrl} alt={t("photoAlt", { name: g.name })} width={400} height={300} className="aspect-[4/3] w-full object-cover" />
            ) : (
              <div className="aspect-[4/3] w-full bg-foreground/5" aria-hidden="true" />
            )}
            <div className="flex flex-1 flex-col gap-1 p-3">
              <p className="font-semibold">{g.name}</p>
              <p className="text-sm text-muted">{t("fromStore", { store: g.storeName })}</p>
              <p className="mt-auto font-semibold">
                {t("cost", { points: formatPoints(g.costCentipoints) })}
                {g.soldOut && <span className="ml-2 rounded bg-foreground/10 px-2 py-0.5 text-xs font-medium">{t("soldOut")}</span>}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
