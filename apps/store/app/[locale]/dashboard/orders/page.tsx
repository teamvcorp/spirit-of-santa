/**
 * /dashboard/orders (Phase 6 slice 3): gifts children have funded at this store.
 *  - Set aside: fully funded, the parent can still remove it → keep one, don't ship.
 *  - Ready to ship: locked → ship to Spirit O Santa's address, write the reference on the package,
 *    then "Mark shipped".
 *  - Out of stock: funded but none left → Spirit O Santa contacts the store about a substitute.
 *  - Shipped: the last 60 days.
 * Owners AND reps. Shows only the item + reference code: never anything about the child.
 */
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { storeOrders, type OrderRow } from "@repo/wishlists/fulfilment";
import { storePayoutView } from "@repo/wishlists/payouts";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { DashboardNav } from "../dashboard-nav";
import { loadMember } from "../member";
import { NoAccess } from "../no-access";
import { ShipForm } from "./ship-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Orders");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  const { user, store, isOwner } = await loadMember();
  if (!store) return <NoAccess />;
  // store._id comes from loadMember (membership checked in the DB), never from the request.
  const [orders, t, format, pay] = await Promise.all([storeOrders({ id: user.id, role: user.role, storeId: user.storeId }), getTranslations("Orders"), getFormatter(), storePayoutView(store._id)]);
  if (!orders) return <NoAccess />;
  const day = (d: Date | null) => (d ? format.dateTime(new Date(d), { month: "short", day: "numeric" }) : "");
  const line = (r: OrderRow) => (
    <>
      <span className="font-semibold">{r.itemName}</span> · <span className="font-mono" data-ref>{r.ref}</span>
    </>
  );
  return (
    <>
      <DashboardNav isOwner={isOwner} current="orders" />
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>

      <Card className="mb-6" data-testid="ready">
        <h2 className="mb-1 text-lg font-semibold">{t("readyTitle", { count: orders.ready.length })}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("readyIntro")}</p>
        {orders.shippingAddress ? (
          <div className="mb-4 rounded-lg bg-foreground/5 p-3">
            <p className="text-sm font-semibold">{t("shipTo")}</p>
            <p className="whitespace-pre-line" data-testid="ship-to">{orders.shippingAddress}</p>
          </div>
        ) : (
          <Alert tone="error" className="mb-4">{t("noAddress")}</Alert>
        )}
        {orders.ready.length === 0 ? (
          <p className="text-foreground/70">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {orders.ready.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3">
                <p>{line(r)}</p>
                <ShipForm wishId={r.id} refCode={r.ref} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-6" data-testid="set-aside">
        <h2 className="mb-1 text-lg font-semibold">{t("setAsideTitle", { count: orders.setAside.length })}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("setAsideIntro")}</p>
        {orders.setAside.length === 0 ? (
          <p className="text-foreground/70">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {orders.setAside.map((r) => (
              <li key={r.id} className="py-3">
                <p>{line(r)}</p>
                <p className="text-sm text-foreground/70">{t("fundedOn", { date: day(r.fullyFundedAt) })}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {orders.outOfStock.length > 0 && (
        <Card className="mb-6" data-testid="out-of-stock">
          <h2 className="mb-1 text-lg font-semibold">{t("outTitle", { count: orders.outOfStock.length })}</h2>
          <p className="mb-3 text-sm text-foreground/70">{t("outIntro")}</p>
          <ul className="flex flex-col divide-y divide-foreground/10">
            {orders.outOfStock.map((r) => (
              <li key={r.id} className="py-3">
                <p>{line(r)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6" data-testid="payments">
        <h2 className="mb-2 text-lg font-semibold">{t("paymentsTitle")}</h2>
        {pay.owedCount > 0 && <p className="mb-3" data-testid="owed-now">{t("owedNow", { amount: formatCents(pay.owedCents), count: pay.owedCount })}</p>}
        {pay.payouts.length === 0 ? (
          <p className="text-foreground/70">{t("noPayments")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10 text-sm">
            {pay.payouts.map((p) => (
              <li key={p.id} className="py-2">
                {t("paidLine", { amount: formatCents(p.amountCents), date: p.paidOn, count: p.giftCount, method: t(`methods.${p.method}` as never) })}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="shipped">
        <h2 className="mb-3 text-lg font-semibold">{t("shippedTitle")}</h2>
        {orders.shipped.length === 0 ? (
          <p className="text-foreground/70">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {orders.shipped.map((r) => (
              <li key={r.id} className="py-3">
                <p>{line(r)}</p>
                <p className="text-sm text-foreground/70">
                  {t("shippedOn", { date: day(r.shippedAt) })}
                  {r.trackingNote ? ` · ${r.trackingNote}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default async function OrdersPage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
