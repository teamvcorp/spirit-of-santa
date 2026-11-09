/**
 * Gift browser for one kid (Phase 6 slice 2). Kids use it on the parent's signed-in device, so
 * NO PIN, like the kid page. Search / category / sort / page are plain URL params (a GET form):
 * shareable, works without JavaScript, and validated by `parseGiftQuery` (bad values = defaults).
 * Only approved stores' active items for this season are listed (@repo/wishlists/catalog).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { browseGifts, GIFT_SORTS, parseGiftQuery, type GiftQuery } from "@repo/wishlists/catalog";
import { Card } from "@repo/ui/card";
import { Alert } from "@repo/ui/alert";
import { getSeasonState } from "@repo/stores/season";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";
import { buttonClass } from "@repo/ui/button";
import { SeasonGate } from "@/components/season-gate";
import { GiftGrid } from "@/components/gift-grid";

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
  const [kid, season] = await Promise.all([getKid(parent, id), getSeasonState()]);
  if (!kid) notFound(); // another family's kid looks the same as a missing one
  const query = parseGiftQuery(sp);
  const result = await browseGifts(query);
  return (
    <>
      <Link href={`/kids/${kid.id}`} className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("backToKid", { name: kid.firstName })}
      </Link>
      <h1 className="text-3xl font-bold">{t("browseTitle")}</h1>
      {/* Browsing is always fine; adding isn't for an unregistered child or outside the open season. */}
      {!kid.registered ? <Alert className="my-3">{t("why.notRegistered")}</Alert> : season.phase !== "open" ? <Alert className="my-3">{t("why.seasonNotOpen")}</Alert> : null}
      <p className="mb-4 text-muted">{t("browseIntro")}</p>

      {/* GET form: the filters live in the URL (no Server Action needed for reading). */}
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end" role="search">
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

      <p className="mb-3 text-sm text-muted" data-testid="gift-count">
        {t("results", { count: result.total })}
      </p>
      {result.items.length === 0 ? (
        <Card>
          <p>{t("noResults")}</p>
        </Card>
      ) : (
        <GiftGrid items={result.items} hrefFor={(gid) => `/kids/${kid.id}/gifts/${gid}`} />
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
      <SeasonGate>
        <Suspense fallback={null}>
          <Content params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
