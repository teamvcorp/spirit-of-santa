import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { storeOrders } from "@repo/wishlists/fulfilment";
import { Link } from "@/i18n/navigation";
import { DashboardNav } from "./dashboard-nav";
import { loadMember } from "./member";
import { NoAccess } from "./no-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Overview() {
  const { user, store, isOwner } = await loadMember();
  if (!store) return <NoAccess />;
  const [t, statusT, orders] = await Promise.all([getTranslations("Dashboard"), getTranslations("Common.storeStatus"), storeOrders({ id: user.id, role: user.role, storeId: user.storeId })]);
  return (
    <>
      <DashboardNav isOwner={isOwner} current="overview" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{store.name}</h1>
        <span className="rounded-full border border-foreground/20 px-3 py-1 text-sm">{statusT(store.status)}</span>
      </div>
      <Alert tone={store.status === "rejected" || store.status === "suspended" ? "error" : "info"} className="mb-6">
        {/* Only the "rejected" text has a {reason} placeholder; the others ignore it. */}
        {(t as unknown as (k: string, v?: Record<string, string>) => string)(`statusHelp.${store.status}`, { reason: store.rejectionReason ?? "" })}
      </Alert>
      {orders && orders.ready.length + orders.setAside.length > 0 && (
        <Alert tone={orders.ready.length > 0 ? "error" : "info"} className="mb-6">
          <span data-testid="orders-alert">{t("ordersAlert", { ready: orders.ready.length, setAside: orders.setAside.length })}</span>{" "}
          <Link href="/dashboard/orders" className="font-semibold underline underline-offset-4">
            {t("nav.orders")}
          </Link>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {isOwner && (
          <Card>
            <h2 className="text-lg font-semibold">{t("profileCardTitle")}</h2>
            <p className="mb-3 mt-1 text-sm text-foreground/70">{t("profileCardBody")}</p>
            <Link href="/dashboard/profile" className="font-semibold underline underline-offset-4">
              {t("nav.profile")}
            </Link>
          </Card>
        )}
        {isOwner && (
          <Card>
            <h2 className="text-lg font-semibold">{t("repsCardTitle")}</h2>
            <p className="mb-3 mt-1 text-sm text-foreground/70">{t("repsCardBody", { count: store.repUserIds?.length ?? 0 })}</p>
            <Link href="/dashboard/reps" className="font-semibold underline underline-offset-4">
              {t("nav.reps")}
            </Link>
          </Card>
        )}
        <Card>
          <h2 className="text-lg font-semibold">{t("itemsCardTitle")}</h2>
          <p className="mb-3 mt-1 text-sm text-foreground/70">{t("itemsCardBody")}</p>
          <Link href="/dashboard/items" className="font-semibold underline underline-offset-4">
            {t("nav.items")}
          </Link>
        </Card>
      </div>
      <p className="mt-6 text-sm text-foreground/70">{t(isOwner ? "signedInOwner" : "signedInRep", { email: user.email })}</p>
    </>
  );
}

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}