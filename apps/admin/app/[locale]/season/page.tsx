/**
 * /season: season dates, store item window and force-freeze (Phase 3 slice 2).
 * Rules: dates editable only before a season opens; the two switches any time
 * (user decisions 2026-11-05). All enforced in @repo/stores/season.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { seasonAdminView } from "@repo/stores/season";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { DatesForm, ForceFreezeForm, StoreWindowForm } from "./season-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Season");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [view, t, format] = await Promise.all([seasonAdminView(), getTranslations("Season"), getFormatter()]);
  const { state } = view.current;
  // "2027-10-01" → "October 1, 2027". Noon UTC + timeZone UTC: the calendar day never shifts.
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("nowTitle", { year: state.year })}</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{t("phaseLabel")}</dt>
          <dd className="font-semibold" data-testid="season-phase">
            {t(`phase.${state.phase}`)} <span className="font-normal text-muted">({t(`source.${state.phaseSource}`)})</span>
          </dd>
          <dt className="text-muted">{t("datesLabel")}</dt>
          <dd>{t("datesLine", { open: day(state.dates.open), freeze: day(state.dates.freeze), close: day(state.dates.close) })}</dd>
          <dt className="text-muted">{t("windowLabel")}</dt>
          <dd data-testid="season-window">
            {state.storeWindowOpen ? t("windowOpen") : t("windowClosed")} <span className="text-muted">({t(`window.${state.storeWindowMode}`)})</span>
          </dd>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("windowTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{t("windowIntro")}</p>
        <StoreWindowForm mode={state.storeWindowMode} />
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("freezeTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{state.forceFrozen ? t("freezeOnIntro") : t("freezeIntro")}</p>
        <ForceFreezeForm on={state.forceFrozen} canFreeze={state.phase === "open"} />
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("datesTitle", { year: state.year })}</h2>
        {state.datesLocked ? <Alert className="mb-4">{t("datesLocked")}</Alert> : <p className="mb-4 text-sm text-muted">{t("datesIntro")}</p>}
        <DatesForm year={state.year} custom={view.current.custom} defaults={view.current.defaults} locked={state.datesLocked} />
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t("datesTitle", { year: view.next.year })}</h2>
        <p className="mb-4 text-sm text-muted">{t("datesIntro")}</p>
        <DatesForm year={view.next.year} custom={view.next.custom} defaults={view.next.defaults} locked={false} />
      </Card>
    </div>
  );
}

export default async function SeasonPage() {
  const t = await getTranslations("Season");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-muted">{t("intro")}</p>
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
