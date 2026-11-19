/**
 * Admin's copy of a store's founding partner fee invoice (2026-11-18). Printable with the browser's Print.
 * Same content as the store's own copy: both come from buildFeeInvoice (@repo/stores/partner-fee).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { isLocale } from "@repo/lib/locales";
import { buildFeeInvoice, getPartnerFee } from "@repo/stores/partner-fee";
import { objectIdSchema } from "@repo/stores/schemas";
import { Card } from "@repo/ui/card";
import { FeeInvoice } from "@repo/ui/fee-invoice";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.feeInvoice");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Invoice({ params }: { params: PageProps<"/[locale]/stores/[id]/invoice">["params"] }) {
  await connection();
  await requireRole(authOptions, "admin");
  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) notFound();
  const [fee, t, locale, adminT] = await Promise.all([getPartnerFee(id), getTranslations("Common.feeInvoice"), getLocale(), getTranslations("StoreAdmin.fee")]);
  if (!fee || fee.status === "not_required" || !fee.invoiceNo) notFound();
  const inv = buildFeeInvoice(fee, (k, v) => t(k as never, v as never), isLocale(locale) ? locale : "en");
  return (
    <>
      <Link href={`/stores/${id}`} className="mb-4 inline-block text-sm underline underline-offset-4 print:hidden">
        ← {adminT("backToStore")}
      </Link>
      <Card>
        <FeeInvoice {...inv} />
      </Card>
      <p className="mt-3 text-sm text-muted print:hidden">{adminT("printHint")}</p>
    </>
  );
}

export default function AdminInvoicePage({ params }: PageProps<"/[locale]/stores/[id]/invoice">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Suspense fallback={null}>
        <Invoice params={params} />
      </Suspense>
    </main>
  );
}
