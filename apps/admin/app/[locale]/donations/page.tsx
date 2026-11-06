/**
 * /donations: community-donation pools and the Dec 1 split (Phase 5 slice 2b). Admin only.
 * Shows what a run would do RIGHT NOW (per pool: gifts, total, fee, kids, points each), past runs,
 * a "Split now" button (season frozen/closed + fee set; the daily cron does the same) and the
 * tax-receipt counts with "retry failed".
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { formatCents, formatPoints } from "@repo/lib/format";
import { receiptCounts } from "@repo/payments/receipts";
import { listDonationSplits, previewDonationSplit } from "@repo/payments/split";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { RetryReceiptsForm, SplitForm } from "./donation-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Donations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [preview, runs, counts, t, format] = await Promise.all([previewDonationSplit(), listDonationSplits(), receiptCounts(), getTranslations("Donations"), getFormatter()]);
  const pct = (bps: number) => `${bps / 100}%`;
  const willShare = preview.pools.some((p) => p.status === "split");
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("poolsTitle", { year: preview.seasonYear })}</h2>
        <p className="mb-4 text-sm text-foreground/70">{t("poolsIntro", { fee: preview.feeBps === null ? "?" : pct(preview.feeBps) })}</p>
        {preview.pools.length === 0 ? (
          <p className="text-foreground/70">{t("noPools")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="pools">
              <thead>
                <tr className="border-b border-foreground/20">
                  <th className="py-2 pr-3">{t("pool")}</th>
                  <th className="py-2 pr-3">{t("gifts")}</th>
                  <th className="py-2 pr-3">{t("total")}</th>
                  <th className="py-2 pr-3">{t("fee")}</th>
                  <th className="py-2 pr-3">{t("kids")}</th>
                  <th className="py-2 pr-3">{t("each")}</th>
                  <th className="py-2">{t("statusCol")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.pools.map((p) => (
                  <tr key={p.zip ?? "all"} className="border-b border-foreground/10" data-pool={p.zip ?? "all"}>
                    <td className="py-2 pr-3">{p.zip ?? t("allKids")}</td>
                    <td className="py-2 pr-3">{p.paymentCount}</td>
                    <td className="py-2 pr-3">{formatCents(p.totalCents)}</td>
                    <td className="py-2 pr-3">{formatCents(p.feeCents)}</td>
                    <td className="py-2 pr-3">{p.kids}</td>
                    <td className="py-2 pr-3">{formatPoints(p.perKidCentipoints)}</td>
                    <td className="py-2">{t(`status.${p.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("runTitle")}</h2>
        {preview.reason ? <Alert className="mb-4">{t(`reason.${preview.reason}`)}</Alert> : <p className="mb-4 text-sm text-foreground/70">{t("runIntro")}</p>}
        <SplitForm enabled={preview.canRun && willShare} />
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("historyTitle")}</h2>
        {runs.length === 0 ? (
          <p className="text-foreground/70">{t("noRuns")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-testid="runs">
            {runs.map((r) => (
              <li key={r.id}>
                {t("runLine", {
                  when: r.at ? format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }) : "",
                  by: t(`trigger.${r.trigger}`),
                  amount: formatCents(r.totalCents),
                  fee: formatCents(r.feeCents),
                  kids: r.kidsCredited,
                })}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("receiptsTitle")}</h2>
        <p className="mb-3" data-testid="receipt-counts">{t("receiptCounts", { pending: counts.pending, sent: counts.sent, failed: counts.failed })}</p>
        <RetryReceiptsForm />
      </Card>
    </div>
  );
}

export default async function DonationsPage() {
  const t = await getTranslations("Donations");
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
