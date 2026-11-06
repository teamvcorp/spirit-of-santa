import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MAX_STORE_PHOTOS } from "@repo/stores/owner";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { DashboardNav } from "../dashboard-nav";
import { isStoreEditable, loadMember } from "../member";
import { NoAccess } from "../no-access";
import { Photos } from "./photos";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Profile");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  const { store, isOwner } = await loadMember();
  if (!store || !isOwner) return <NoAccess />;
  const t = await getTranslations("Profile");
  const editable = isStoreEditable(store.status);
  const a = store.contact?.address;
  return (
    <>
      <DashboardNav isOwner current="profile" />
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      {!editable && <Alert className="mb-4">{t("readOnly")}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t("details")}</h2>
          <ProfileForm
            editable={editable}
            initial={{
              storeName: store.name,
              category: store.category,
              description: store.description ?? "",
              phone: store.contact?.phone ?? "",
              website: store.contact?.website ?? "",
              line1: a?.line1 ?? "",
              city: a?.city ?? "",
              state: a?.state ?? "",
              zip: a?.zip ?? "",
            }}
          />
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">{t("photos")}</h2>
          <Photos editable={editable} max={MAX_STORE_PHOTOS} photos={(store.photos ?? []).map((p) => ({ url: p.url, pathname: p.pathname }))} />
        </Card>
      </div>
    </>
  );
}

export default async function ProfilePage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}