import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { formatCents } from "@repo/lib/format";
import { formatDiscount } from "@repo/lib/store";
import { listStoreItems } from "@repo/stores/items";
import { Alert } from "@repo/ui/alert";
import { Link } from "@/i18n/navigation";
import { DashboardNav } from "../dashboard-nav";
import { loadMember } from "../member";
import { NoAccess } from "../no-access";
import { InventoryForm } from "./item-ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Items");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  const { store, isOwner } = await loadMember();
  if (!store) return <NoAccess />;
  const data = await listStoreItems(store, isOwner); // store already loaded + membership-checked
  const [t, statusT] = await Promise.all([getTranslations("Items"), getTranslations("Items.status")]);
  const canAdd = data.editable && data.window.open && data.count < data.limit;
  const active = data.items.filter((i) => i.status !== "archived");
  const archived = data.items.filter((i) => i.status === "archived");
  return (
    <>
      <DashboardNav isOwner={isOwner} current="items" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-foreground/70">{t("count", { count: data.count, limit: data.limit })}</p>
        </div>
        {canAdd && (
          <Link href="/dashboard/items/new" className="rounded-lg bg-brand-red px-4 py-2 font-semibold text-white hover:bg-brand-red-dark">
            {t("addButton")}
          </Link>
        )}
      </div>
      <Alert className="mb-4">{data.window.open ? t("windowOpen") : t("windowClosed")}</Alert>
      {!data.editable && <Alert className="mb-4">{t("readOnly")}</Alert>}
      {isOwner && data.discountBps != null && <p className="mb-4 text-sm text-foreground/70">{t("discountNote", { discount: formatDiscount(data.discountBps) })}</p>}
      {active.length === 0 ? (
        <p className="text-foreground/70">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-foreground/15">
                <th className="py-2 pr-4">{t("colItem")}</th>
                <th className="py-2 pr-4">{t("colPrice")}</th>
                {isOwner && <th className="py-2 pr-4">{t("colWholesale")}</th>}
                <th className="py-2 pr-4">{t("colStock")}</th>
                <th className="py-2 pr-4">{t("colViews")}</th>
                <th className="py-2">{t("colAdds")}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((i) => (
                <tr key={i.id} className="border-b border-foreground/10 align-top">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/items/${i.id}`} className="font-semibold underline underline-offset-4">
                      {i.name}
                    </Link>
                    {i.status === "draft" && <span className="ml-2 rounded-full border border-foreground/30 px-2 text-xs">{statusT("draft")}</span>}
                  </td>
                  <td className="py-2 pr-4">{i.priceCents != null ? formatCents(i.priceCents) : t("needsPrice")}</td>
                  {isOwner && <td className="py-2 pr-4">{i.wholesaleCents != null ? formatCents(i.wholesaleCents) : "—"}</td>}
                  <td className="py-2 pr-4">{data.editable ? <InventoryForm itemId={i.id} inventory={i.inventory} label={i.name} /> : i.inventory}</td>
                  <td className="py-2 pr-4">{i.stats.impressions}</td>
                  <td className="py-2">{i.stats.wishListAdds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold">{t("archivedHeading", { count: archived.length })}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {archived.map((i) => (
              <li key={i.id}>
                <Link href={`/dashboard/items/${i.id}`} className="underline underline-offset-4">
                  {i.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default async function ItemsPage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}