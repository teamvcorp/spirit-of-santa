/**
 * /moderation: "Other" deed texts waiting for approval before they're shown on public QR pages.
 * Only the text and date are shown: no child or family details are needed to decide.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { listPendingTexts } from "@repo/deeds/moderation";
import { authOptions } from "@/auth";
import { ReviewButtons } from "./review-buttons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Moderation");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [rows, t, format] = await Promise.all([listPendingTexts(), getTranslations("Moderation"), getFormatter()]);
  if (rows.length === 0) return <p className="text-foreground/70">{t("empty")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-foreground/10 rounded-2xl border border-foreground/15" data-testid="moderation-list">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="whitespace-pre-line">{r.text}</p>
            <p className="text-sm text-foreground/70">{format.dateTime(new Date(r.createdAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
          </div>
          <ReviewButtons id={r.id} />
        </li>
      ))}
    </ul>
  );
}

export default async function ModerationPage() {
  const t = await getTranslations("Moderation");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
