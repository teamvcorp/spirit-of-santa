import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { STORE_STATUSES } from "@repo/db";
import { formatDiscount } from "@repo/lib/store";
import { listStores, storeStatusCounts, STORES_PAGE_SIZE, type StoreStatus } from "@repo/stores/queries";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@repo/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("StoreAdmin");
  return { title: t("queueTitle") };
}

/** Request-time part (session + ?status): streams in after the static shell. */
async function Queue({ searchParams }: { searchParams: PageProps<"/[locale]/stores">["searchParams"] }) {
  await connection(); // next-auth makes random CSRF bytes: must not run during prerender
  await requireRole(authOptions, "admin"); // not signed in → /signin; not admin → 404
  const sp = await searchParams;
  const status: StoreStatus = (STORE_STATUSES as readonly string[]).includes(String(sp.status)) ? (sp.status as StoreStatus) : "pending";
  // ?page=1,2,… (1-based in the URL). Clamp junk to 1.
  const pageNum = Math.max(1, Math.min(10_000, Number.parseInt(String(sp.page ?? "1"), 10) || 1));
  const [counts, rows, t, statusT, cats, format] = await Promise.all([
    storeStatusCounts(),
    listStores(status, pageNum - 1),
    getTranslations("StoreAdmin"),
    getTranslations("Common.storeStatus"),
    getTranslations("Common.storeCategories"),
    getFormatter(),
  ]);
  return (
    <>
      <nav aria-label={t("statusTabs")} className="mb-4 flex flex-wrap gap-2">
        {STORE_STATUSES.map((s) => (
          <Link
            key={s}
            href={{ pathname: "/stores", query: { status: s } }}
            aria-current={s === status ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${s === status ? "border-primary bg-primary text-on-primary" : "border-foreground/20"}`}
          >
            {statusT(s)} ({counts[s]})
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-foreground/70">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-foreground/15">
                <th className="py-2 pr-4">{t("colStore")}</th>
                <th className="py-2 pr-4">{t("colCategory")}</th>
                <th className="py-2 pr-4">{t("colLocation")}</th>
                <th className="py-2 pr-4">{t("colOwner")}</th>
                <th className="py-2 pr-4">{t("colDiscount")}</th>
                <th className="py-2">{t("colSince")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-foreground/10">
                  <td className="py-2 pr-4">
                    <Link href={`/stores/${r.id}`} className="font-semibold underline underline-offset-4">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{cats(r.category as never)}</td>
                  <td className="py-2 pr-4">{[r.city, r.state].filter(Boolean).join(", ")}</td>
                  <td className="py-2 pr-4">{r.ownerEmail}</td>
                  <td className="py-2 pr-4">{r.discountBps != null ? formatDiscount(r.discountBps) : "—"}</td>
                  <td className="py-2">{format.dateTime(new Date(r.createdAt), { dateStyle: "medium" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {counts[status] > STORES_PAGE_SIZE && (
        <nav aria-label={t("pagination")} className="mt-4 flex items-center gap-4 text-sm">
          <span>
            {t("showing", {
              from: Math.min((pageNum - 1) * STORES_PAGE_SIZE + 1, counts[status]),
              to: Math.min(pageNum * STORES_PAGE_SIZE, counts[status]),
              total: counts[status],
            })}
          </span>
          {pageNum > 1 && (
            <Link href={{ pathname: "/stores", query: { status, page: pageNum - 1 } }} className="underline underline-offset-4">
              {t("previous")}
            </Link>
          )}
          {pageNum * STORES_PAGE_SIZE < counts[status] && (
            <Link href={{ pathname: "/stores", query: { status, page: pageNum + 1 } }} className="underline underline-offset-4">
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
export default async function StoresPage({ searchParams }: PageProps<"/[locale]/stores">) {
  const t = await getTranslations("StoreAdmin");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("queueTitle")}</h1>
        <Link href="/stores/invite" className={buttonClass()}>
          {t("inviteButton")}
        </Link>
      </div>
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </main>
  );
}