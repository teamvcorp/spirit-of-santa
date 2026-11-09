/**
 * /kids/<id>/surprise: the PARENT's surprise gifts for one child (owner 2026-11-08). Behind the parent PIN.
 *
 *  - Lists this child's surprise gifts AS THEY REALLY ARE (kidWishList with reveal: true): photo, name, progress.
 *    The child's own pages only ever get the masked version (wrapped gift).
 *  - "Fund it now": the pay-up checkout, $1.50 per Christmas Magic, allowed for surprises while the season is
 *    open. The webhook fills THAT gift first, so a paid surprise is guaranteed (fully funded = secured).
 *    Left alone, a surprise fills with Christmas Magic in the normal oldest-first order.
 *  - A gift search (same filters as the child's browser, shared GiftGrid) to pick a new surprise.
 * The pricing note under the list is deliberately quiet (owner): what the rate helps pay for, not a sales line.
 */
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents, formatPoints } from "@repo/lib/format";
import { normalizeObjectId } from "@repo/lib/ids";
import { browseGifts, kidWishList, parseGiftQuery } from "@repo/wishlists/catalog";
import { payUpCents } from "@repo/wishlists/payup";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { buttonClass } from "@repo/ui/button";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { GiftGrid } from "@/components/gift-grid";
import { MagicBar } from "@/components/magic-bar";
import { SeasonGate } from "@/components/season-gate";
import { PayUpForm } from "../../../parent/payup/payup-form";
import { fundSurpriseAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Surprise");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/kids/[id]/surprise">;

async function Content({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const kidId = normalizeObjectId(id);
  if (!kidId) notFound();
  const parent = await requireUnlockedPage(`/kids/${kidId}/surprise`);
  const [kid, list, t, g] = await Promise.all([getKid(parent, kidId), kidWishList(parent, kidId, undefined, { reveal: true }), getTranslations("Surprise"), getTranslations("Gifts")]);
  if (!kid || !list) notFound(); // another family's child looks the same as a missing one
  const surprises = list.rows.filter((r) => r.surprise);
  const canAdd = kid.registered && list.seasonOpen;
  const query = parseGiftQuery(sp);
  const result = canAdd ? await browseGifts(query) : null;
  const progress = (funded: number, cost: number) => g("progress", { funded: formatPoints(funded), cost: formatPoints(cost) });
  return (
    <>
      <Link href={`/kids/${kid.id}`} className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {g("backToKid", { name: kid.firstName })}
      </Link>
      <Card className="mb-6">
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        <p className="mb-4 text-muted">{t("intro", { name: kid.firstName })}</p>
        {!kid.registered ? <Alert className="mb-4">{g("why.notRegistered")}</Alert> : !list.seasonOpen ? <Alert className="mb-4">{g("why.seasonNotOpen")}</Alert> : null}
        {surprises.length === 0 ? (
          <p className="text-muted">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10" data-testid="surprise-list">
            {surprises.map((w) => {
              const missing = w.costCentipoints - w.fundedCentipoints;
              const cents = payUpCents(missing);
              return (
                <li key={w.id} className="flex gap-4 py-4" data-wish={w.id} data-wish-status={w.status}>
                  {w.photoUrl ? (
                    <Image src={w.photoUrl} alt={g("photoAlt", { name: w.name })} width={96} height={72} className="aspect-[4/3] h-18 w-24 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <div className="aspect-[4/3] h-18 w-24 shrink-0 rounded-2xl bg-foreground/5" aria-hidden="true" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="font-semibold">{w.name}</p>
                    <p className="text-sm text-muted">
                      {g("fromStore", { store: w.storeName })} · {g(`status.${w.status}` as never)}
                    </p>
                    <MagicBar value={w.fundedCentipoints} max={w.costCentipoints} label={g("progressLabel", { name: w.name })} valueText={progress(w.fundedCentipoints, w.costCentipoints)} />
                    <p className="text-sm font-bold">{progress(w.fundedCentipoints, w.costCentipoints)}</p>
                    {w.status === "active" && missing > 0 && list.seasonOpen && (
                      <PayUpForm wishId={w.id} cents={cents} label={t("fundFor", { item: w.name })} action={fundSurpriseAction} buttonText={t("fund", { amount: formatCents(cents) })} />
                    )}
                    {w.removable && (
                      <Link href={`/kids/${kid.id}/wishlist/${w.id}/remove`} className="self-start text-sm underline underline-offset-4">
                        {g("remove")}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* Quiet on purpose (owner): what the rate helps pay for. Rate from the server constant, never hard-coded. */}
        <p className="mt-4 text-xs text-muted" data-testid="surprise-rate">
          {t("rateNote", { rate: formatCents(CENTS_PER_POINT) })}
        </p>
      </Card>

      {result && (
        <section aria-labelledby="surprise-find">
          <h2 id="surprise-find" className="mb-1 text-xl font-bold">
            {t("findTitle")}
          </h2>
          <p className="mb-4 text-sm text-muted">{t("findIntro", { name: kid.firstName })}</p>
          {/* GET form: the search lives in the URL, like the child's gift browser. */}
          <form method="get" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end" role="search">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              {g("searchLabel")}
              <input name="q" type="search" defaultValue={query.q} maxLength={60} placeholder={g("searchPlaceholder")} className="rounded-lg border border-foreground/20 bg-background px-3 py-2" />
            </label>
            <button type="submit" className={buttonClass()}>
              {g("apply")}
            </button>
          </form>
          {result.items.length === 0 ? <p className="text-muted">{g("noResults")}</p> : <GiftGrid items={result.items} hrefFor={(gid) => `/kids/${kid.id}/surprise/${gid}`} />}
          {result.pages > 1 && <p className="mt-3 text-sm text-muted">{t("narrow", { shown: result.items.length, total: result.total })}</p>}
        </section>
      )}
    </>
  );
}

export default function SurprisePage(props: Props) {
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
