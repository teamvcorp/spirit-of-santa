/**
 * /payouts (Phase 6 slice 5): what Spirit O Santa owes each store for received gifts, recording
 * payments made outside the app (check / transfer), the history, and the season money summary
 * (collected, given back, wholesale, breakage, net). Admin only. `?year=` picks the season.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { formatCents, formatPoints } from "@repo/lib/format";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { listPayouts, owedByStore, seasonMoney } from "@repo/wishlists/payouts";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { authOptions } from "@/auth";
import { PayoutForm } from "./payout-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Payouts");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/payouts">;

async function Content({ searchParams }: Pick<Props, "searchParams">) {
  await connection();
  await requireRole(authOptions, "admin");
  const current = getSeasonYear();
  const sp = await searchParams;
  const raw = sp.year;
  const year = typeof raw === "string" && /^\d{4}$/.test(raw) && Number(raw) >= 2026 && Number(raw) <= current ? Number(raw) : current;
  const [owed, history, money, t] = await Promise.all([owedByStore(), listPayouts(), seasonMoney(year), getTranslations("Payouts")]);
  const today = isoDay(calendarDateIn(new Date()));
  // Just recorded (?paid=<id>): confirm it here (the store's owed row is gone by now).
  const justPaid = typeof sp.paid === "string" ? history.find((h) => h.id === sp.paid) : undefined;
  const row = (label: string, cents: number, testId?: string, strong = false) => (
    <div className={`flex justify-between gap-4 py-1 ${strong ? "border-t border-foreground/20 pt-2 font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd data-testid={testId}>{formatCents(cents)}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      {justPaid && <Alert>{t("recorded", { amount: formatCents(justPaid.amountCents), store: justPaid.storeName })}</Alert>}
      <Card data-testid="owed">
        <h2 className="mb-1 text-lg font-semibold">{t("owedTitle")}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("owedIntro")}</p>
        {owed.length === 0 ? (
          <p className="text-foreground/70">{t("nothingOwed")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {owed.map((o) => (
              <li key={o.storeId} className="flex flex-col gap-3 py-4" data-store={o.storeId}>
                <p>
                  <span className="font-semibold">{o.storeName}</span> · {t("owedLine", { amount: formatCents(o.owedCents), count: o.giftCount })} · {o.storeEmail}
                </p>
                {o.missingAmount > 0 ? (
                  <Alert tone="error">{t("missingAmount", { count: o.missingAmount })}</Alert>
                ) : (
                  <PayoutForm storeId={o.storeId} storeName={o.storeName} owedCents={o.owedCents} today={today} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="money">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("moneyTitle", { year })}</h2>
          <nav className="flex gap-3 text-sm" aria-label={t("seasons")}>
            {[current - 1, current].filter((y) => y >= 2026).map((y) => (
              <Link key={y} href={`/payouts?year=${y}`} aria-current={y === year ? "page" : undefined} className={y === year ? "font-semibold" : "underline underline-offset-4"}>
                {y}
              </Link>
            ))}
          </nav>
        </div>
        <dl className="text-sm">
          {Object.entries(money.collected).map(([purpose, cents]) => row(t(`purpose.${purpose}` as never), cents, `collected-${purpose}`))}
          {row(t("collectedTotal"), money.collectedTotal, "collected-total", true)}
          {row(t("givenBack"), -money.givenBack, "given-back")}
          {row(t("wholesale", { count: money.gifts.count }), -(money.gifts.wholesalePaidCents + money.gifts.wholesaleOwedCents), "wholesale")}
          {row(t("net"), money.netCents, "net", true)}
        </dl>
        <h3 className="mb-1 mt-4 font-semibold">{t("marginTitle")}</h3>
        <dl className="text-sm">
          {row(t("retailOut", { count: money.gifts.count }), money.gifts.retailCents, "retail")}
          {row(t("wholesaleMargin"), money.wholesaleMarginCents, "wholesale-margin")}
          {row(t("paidVsOwed", { paid: formatCents(money.gifts.wholesalePaidCents) }), money.gifts.wholesaleOwedCents, "still-owed")}
          {row(t("breakage", { reset: formatPoints(money.breakage.resetCentipoints), forfeit: formatPoints(money.breakage.forfeitCentipoints) }), money.breakage.valueCents, "breakage")}
        </dl>
        {money.gifts.withoutAmount > 0 && <Alert tone="error" className="mt-3">{t("withoutAmount", { count: money.gifts.withoutAmount })}</Alert>}
        <p className="mt-3 text-xs text-foreground/70">{t("moneyNote")}</p>
      </Card>

      <Card data-testid="history">
        <h2 className="mb-3 text-lg font-semibold">{t("historyTitle")}</h2>
        {history.length === 0 ? (
          <p className="text-foreground/70">{t("noHistory")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10 text-sm">
            {history.map((h) => (
              <li key={h.id} className="py-2" data-payout={h.id}>
                <span className="font-semibold">{h.storeName}</span> · {formatCents(h.amountCents)} · {t("gifts", { count: h.giftCount })} · {t(`methods.${h.method}` as never)}
                {h.reference ? ` ${h.reference}` : ""} · {h.paidOn}
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default async function PayoutsPage(props: Props) {
  const t = await getTranslations("Payouts");
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>
      <Suspense fallback={null}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
