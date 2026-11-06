import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listStoreItems } from "@repo/stores/items";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { loadMember } from "../../member";
import { NoAccess } from "../../no-access";
import { ItemForm } from "../item-ui";
import { initialValues } from "../item-values";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Items");
  return { title: t("newTitle"), robots: { index: false, follow: false } };
}

async function Content() {
  const { store, isOwner } = await loadMember();
  if (!store) return <NoAccess />;
  const data = await listStoreItems(store, isOwner); // store already loaded + membership-checked
  const t = await getTranslations("Items");
  const canAdd = data.editable && data.window.open && data.count < data.limit;
  return (
    <>
      {!canAdd && <Alert className="mb-4">{!data.window.open ? t("windowClosed") : data.count >= data.limit ? t("limitNote", { limit: data.limit }) : t("readOnly")}</Alert>}
      {!isOwner && <Alert className="mb-4">{t("repDraftNote")}</Alert>}
      <ItemForm initial={initialValues()} isOwner={isOwner} canEdit={canAdd} />
    </>
  );
}

export default async function NewItemPage() {
  const [t, d] = await Promise.all([getTranslations("Items"), getTranslations("Dashboard")]);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <Link href="/dashboard/items" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("backToItems")}
      </Link>
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("newTitle")}</h1>
        <Suspense fallback={<p className="text-foreground/70">{d("loading")}</p>}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}