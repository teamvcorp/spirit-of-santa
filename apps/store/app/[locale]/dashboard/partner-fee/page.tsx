/**
 * The store OWNER's copy of their founding partner fee invoice (2026-11-18). Reps don't see billing.
 * Same content as the admin copy: buildFeeInvoice (@repo/stores/partner-fee). Printable with the browser's Print.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { isLocale } from "@repo/lib/locales";
import { buildFeeInvoice, getPartnerFee } from "@repo/stores/partner-fee";
import { Card } from "@repo/ui/card";
import { FeeInvoice } from "@repo/ui/fee-invoice";
import { Link } from "@/i18n/navigation";
import { loadMember } from "../member";
import { NoAccess } from "../no-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.feeInvoice");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Invoice() {
  const { store, isOwner } = await loadMember();
  if (!store || !isOwner) return <NoAccess />;
  const [fee, t, locale, dashT] = await Promise.all([getPartnerFee(String(store._id)), getTranslations("Common.feeInvoice"), getLocale(), getTranslations("Dashboard")]);
  if (!fee || fee.status === "not_required" || !fee.invoiceNo) return <NoAccess />;
  const inv = buildFeeInvoice(fee, (k, v) => t(k as never, v as never), isLocale(locale) ? locale : "en");
  return (
    <>
      <Link href="/dashboard" className="mb-4 inline-block text-sm underline underline-offset-4 print:hidden">
        ← {dashT("backToDashboard")}
      </Link>
      <Card>
        <FeeInvoice {...inv} />
      </Card>
    </>
  );
}

export default async function PartnerFeePage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Invoice />
      </Suspense>
    </main>
  );
}
