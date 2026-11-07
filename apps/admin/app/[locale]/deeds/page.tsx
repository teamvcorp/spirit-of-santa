/**
 * /deeds: the preset good-deed catalog families choose from (Phase 3 slice 4).
 * Order here = order families see. Off = hidden from families (kept: deeds point at it).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { listDeedTypes } from "@repo/deeds/catalog";
import { formatCents } from "@repo/lib/format";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { DeedRowActions, SeedButton } from "./deed-ui";
import { buttonClass } from "@repo/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deeds");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [rows, t] = await Promise.all([listDeedTypes(), getTranslations("Deeds")]);
  const tip = (min?: number, max?: number) =>
    min != null && max != null ? `${formatCents(min)}–${formatCents(max)}` : min != null ? t("from", { amount: formatCents(min) }) : max != null ? t("upTo", { amount: formatCents(max) }) : "—";
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">{t("empty")}</p>
        <SeedButton />
      </div>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-foreground/10 rounded-2xl border border-foreground/15">
      {rows.map((d, i) => (
        <li key={d.id} className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${d.active ? "" : "bg-foreground/5"}`}>
          <div>
            <Link href={`/deeds/${d.id}`} className="font-semibold underline underline-offset-4">
              {d.title.en}
            </Link>
            {!d.active && <span className="ml-2 rounded-full border border-foreground/30 px-2 text-xs">{t("off")}</span>}
            <p className="text-sm text-muted" lang="es">
              {d.title.es ?? t("noSpanish")}
            </p>
            <p className="text-sm">{t("tipLine", { range: tip(d.tipMinCents, d.tipMaxCents) })}</p>
          </div>
          <DeedRowActions id={d.id} active={d.active} first={i === 0} last={i === rows.length - 1} title={d.title.en} />
        </li>
      ))}
    </ol>
  );
}

export default async function DeedsPage() {
  const t = await getTranslations("Deeds");
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted">{t("intro")}</p>
        </div>
        <Link href="/deeds/new" className={buttonClass()}>
          {t("addButton")}
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
