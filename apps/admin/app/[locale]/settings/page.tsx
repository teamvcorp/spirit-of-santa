/**
 * /settings: platform settings (Phase 5 slice 2): donation-pool fee %, the charity named on tax
 * receipts, the receipts switch, and receipt counts. Admin only (requireRole); saves are audited.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { receiptCounts } from "@repo/payments/receipts";
import { getPlatformSettings } from "@repo/payments/settings";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { calendarDateIn, isoDay } from "@repo/lib/season";
import { authOptions } from "@/auth";
import { SettingsForm } from "./settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [s, counts, t] = await Promise.all([getPlatformSettings(), receiptCounts(), getTranslations("Settings")]);
  return (
    <div className="flex flex-col gap-6">
      {s.donationFeeBps === null && <Alert tone="error">{t("feeMissing")}</Alert>}
      {!s.shippingAddress && <Alert tone="error">{t("shippingMissing")}</Alert>}
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("donationsTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{t("donationsIntro")}</p>
        <SettingsForm
          saved={{
            fee: s.donationFeeBps === null ? "" : String(s.donationFeeBps / 100),
            legalName: s.charity.legalName,
            ein: s.charity.ein,
            address: s.charity.address,
            receipts: s.receiptsEnabled,
            // Not chosen yet: suggest today (Central Time), the admin confirms it.
            fromDay: s.receiptsFromDay || isoDay(calendarDateIn(new Date())),
            shippingAddress: s.shippingAddress,
          }}
        />
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("receiptsTitle")}</h2>
        <p data-testid="receipt-counts">{t("counts", { pending: counts.pending, sent: counts.sent, failed: counts.failed })}</p>
        {counts.before > 0 && <p className="mt-2 text-sm text-muted">{t("before", { count: counts.before, day: s.receiptsFromDay })}</p>}
        {!s.receiptsReady && counts.pending > 0 && <p className="mt-2 text-sm text-muted">{t("waiting")}</p>}
      </Card>
    </div>
  );
}

export default async function SettingsPage() {
  const t = await getTranslations("Settings");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
