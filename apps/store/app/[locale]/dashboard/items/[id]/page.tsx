import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { formatCents } from "@repo/lib/format";
import { getStoreItem } from "@repo/stores/items";
import { objectIdSchema } from "@repo/stores/schemas";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { loadMember } from "../../member";
import { NoAccess } from "../../no-access";
import { ArchiveButton, InventoryForm, ItemForm, ItemPhoto } from "../item-ui";
import { initialValues } from "../item-values";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Items");
  return { title: t("editTitle"), robots: { index: false, follow: false } };
}

async function Content({ params, searchParams }: { params: PageProps<"/[locale]/dashboard/items/[id]">["params"]; searchParams: PageProps<"/[locale]/dashboard/items/[id]">["searchParams"] }) {
  const { store, isOwner } = await loadMember();
  if (!store) return <NoAccess />;
  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) notFound();
  const data = await getStoreItem(store, isOwner, id);
  if (!data) notFound(); // other stores' items and older seasons look the same as missing
  const [t, statusT] = await Promise.all([getTranslations("Items"), getTranslations("Items.status")]);
  const created = (await searchParams).created === "1";
  const { item } = data;
  const archived = item.status === "archived";
  const canEdit = data.editable && data.window.open && !archived;
  return (
    <>
      {created && <Alert className="mb-4">{t("created")}</Alert>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{item.name}</h1>
        <span className="rounded-full border border-foreground/20 px-3 py-1 text-sm">{statusT(item.status)}</span>
      </div>
      {!data.editable && <Alert className="mb-4">{t("readOnly")}</Alert>}
      {data.editable && !data.window.open && <Alert className="mb-4">{t("windowClosed")}</Alert>}
      {data.isOwner && item.wholesaleCents != null && (
        <p className="mb-4 text-sm">{t("wholesaleLine", { price: formatCents(item.priceCents ?? 0), wholesale: formatCents(item.wholesaleCents) })}</p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t("details")}</h2>
          <ItemForm itemId={item.id} initial={initialValues(item)} isOwner={data.isOwner} canEdit={canEdit} priceCents={item.priceCents} />
        </Card>
        <div className="flex flex-col gap-6">
          {/* Stock can change all year: offer it here when the details form is closed. */}
          {data.editable && !archived && !data.window.open && (
            <Card>
              <h2 className="mb-3 text-lg font-semibold">{t("inventory")}</h2>
              <InventoryForm itemId={item.id} inventory={item.inventory} label={item.name} />
            </Card>
          )}
          <Card>
            <h2 className="mb-4 text-lg font-semibold">{t("photo")}</h2>
            <ItemPhoto itemId={item.id} photo={item.photo} canEdit={canEdit} alt={item.name} />
          </Card>
          {data.isOwner && data.editable && data.window.open && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">{archived ? t("restoreTitle") : t("archiveTitle")}</h2>
              <p className="mb-3 text-sm text-foreground/70">{archived ? t("restoreHelp") : t("archiveHelp")}</p>
              <ArchiveButton itemId={item.id} archived={archived} name={item.name} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export default async function EditItemPage(props: PageProps<"/[locale]/dashboard/items/[id]">) {
  const [t, d] = await Promise.all([getTranslations("Items"), getTranslations("Dashboard")]);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Link href="/dashboard/items" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("backToItems")}
      </Link>
      <Suspense fallback={<p className="text-foreground/70">{d("loading")}</p>}>
        <Content params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}