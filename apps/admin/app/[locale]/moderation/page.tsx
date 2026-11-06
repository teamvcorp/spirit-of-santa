/**
 * /moderation: "Other" deed texts waiting for approval before they're shown on public QR pages.
 * Only the text and date are shown: no child or family details are needed to decide.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { listPendingAliases, listPendingTexts } from "@repo/deeds/moderation";
import { authOptions } from "@/auth";
import { ReviewButtons } from "./review-buttons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Moderation");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [rows, aliases, t, format] = await Promise.all([listPendingTexts(), listPendingAliases(), getTranslations("Moderation"), getFormatter()]);
  const when = (d: Date) => format.dateTime(new Date(d), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const list = (items: typeof rows, kind: "deed" | "alias", testId: string) =>
    items.length === 0 ? (
      <p className="text-foreground/70">{t("empty")}</p>
    ) : (
      <ul className="flex flex-col divide-y divide-foreground/10 rounded-2xl border border-foreground/15" data-testid={testId}>
        {items.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="whitespace-pre-line">{r.text}</p>
              <p className="text-sm text-foreground/70">{when(r.createdAt)}</p>
            </div>
            <ReviewButtons id={r.id} kind={kind} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("deedTexts")}</h2>
        {list(rows, "deed", "moderation-list")}
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">{t("aliases")}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("aliasesIntro")}</p>
        {list(aliases, "alias", "alias-list")}
      </section>
    </div>
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
