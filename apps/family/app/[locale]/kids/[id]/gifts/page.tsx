/**
 * Gift browser for one kid (Phase 6 slice 2). Kids use it on the parent's signed-in device, so
 * NO PIN, like the kid page. Search / category / sort / page are plain URL params (a GET form):
 * shareable, works without JavaScript, and validated by `parseGiftQuery` (bad values = defaults).
 * Only approved stores' active items for this season are listed (@repo/wishlists/catalog).
 */
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { formatPoints } from "@repo/lib/format";
import { browseGifts, GIFT_SORTS, parseGiftQuery, type GiftQuery } from "@repo/wishlists/catalog";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";
import { buttonClass } from "@repo/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Gifts");
  return { title: t("browseTitle"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/kids/[id]/gifts">;

/** Same filters, another page (keeps the URL short: defaults are left out). */
function pageHref(kidId: string, q: GiftQuery, page: number) {
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  if (q.category) sp.set("category", q.category);
  if (q.sort !== "price_asc") sp.set("sort", q.sort);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return `/kids/${kidId}/gifts${s ? `?${s}` : ""}`;
}

async function Content({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  await connection();
  const parent = await requireParent();
  const [{ id }, sp, t] = await Promise.all([params, searchParams, getTranslations("Gifts")]);
  const kid = await getKid(parent, id);
  if (!kid) notFound(); // another family's kid looks the same as a missing one
  const query = parseGiftQuery(sp);
  const result = await browseGifts(query);
  return (
    <>
      <Link href={`/kids/${kid.id}`} className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("backToKid", { name: kid.firstName })}
      </Link>
      <h1 className="text-3xl font-bold">{t("browseTitle")}</h1>
      <p className="mb-4 text-foreground/70">{t("browseIntro")}</p>

      {/* GET form: the filters live in the URL (no Server Action needed for reading). */}
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" role="search">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("searchLabel")}
          <input name="q" type="search" defaultValue={query.q} maxLength={60} placeholder={t("searchPlaceholder")} className="rounded-lg border border-foreground/20 bg-background px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("category")}
          <select name="category" defaultValue={query.category} className="rounded-lg border border-foreground/20 bg-background px-3 py-2">
            <option value="">{t("allCategories")}</option>
            {(query.category && !result.categories.includes(query.category) ? [query.category, ...result.categories] : result.categories).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("sort")}
          <select name="sort" defaultValue={query.sort} className="rounded-lg border border-foreground/20 bg-background px-3 py-2">
            {GIFT_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass()}>
          {t("apply")}
        </button>
      </form>

      <p className="mb-3 text-sm text-foreground/70" data-testid="gift-count">
        {t("results", { count: result.total })}
      </p>
      {result.items.length === 0 ? (
        <Card>
          <p>{t("noResults")}</p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="gift-grid">
          {result.items.map((g) => (
            <li key={g.id}>
              <Link href={`/kids/${kid.id}/gifts/${g.id}`} className="flex h-full flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background hover:border-accent focus-visible:border-accent">
                {g.photoUrl ? (
                  <Image src={g.photoUrl} alt={t("photoAlt", { name: g.name })} width={400} height={300} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/3] w-full bg-foreground/5" aria-hidden="true" />
                )}
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-sm text-foreground/70">{t("fromStore", { store: g.storeName })}</p>
                  <p className="mt-auto font-semibold">
                    {t("cost", { points: formatPoints(g.costCentipoints) })}
                    {g.soldOut && <span className="ml-2 rounded bg-foreground/10 px-2 py-0.5 text-xs font-medium">{t("soldOut")}</span>}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.pages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-4 text-sm" aria-label={t("pageOf", { page: result.page, pages: result.pages })}>
          {result.page > 1 ? <Link href={pageHref(kid.id, query, result.page - 1)} className="underline underline-offset-4">← {t("prev")}</Link> : <span />}
          <span>{t("pageOf", { page: result.page, pages: result.pages })}</span>
          {result.page < result.pages ? <Link href={pageHref(kid.id, query, result.page + 1)} className="underline underline-offset-4">{t("next")} →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

export default function GiftsPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={null}>
        <Content params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
