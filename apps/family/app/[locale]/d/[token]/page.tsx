/**
 * /d/<token>: the page a neighbour sees after scanning a kid's QR code. PUBLIC (no account).
 * Shows only the deed + the kid's DISPLAY NAME (+ family alias if switched on). Never indexed; the
 * token isn't leaked to other sites (no-referrer).
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getPublicDeed, publicLimit } from "@repo/deeds/public";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { QrActions } from "./qr-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Qr");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Content({ params }: { params: PageProps<"/[locale]/d/[token]">["params"] }) {
  await connection();
  const [{ token }, t, locale] = await Promise.all([params, getTranslations("Qr"), getLocale()]);
  if (!(await publicLimit(await headers(), "view", 120))) return <Alert tone="error">{t("errors.rateLimited")}</Alert>;
  const view = await getPublicDeed(token, locale);
  if (view.state === "invalid") return <Alert tone="error">{t("invalid")}</Alert>;
  if (view.state === "used") return <Alert>{view.outcome === "paid" ? t("usedPaid") : t("used")}</Alert>;
  if (view.state === "expired") return <Alert>{t("expired")}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="kid-name">
          {t("heading", { name: view.kidName })}
        </h1>
        {view.familyAlias && <p className="text-foreground/70">{t("family", { family: view.familyAlias })}</p>}
        <p className="mt-3 text-xl" data-testid="deed-text">
          {view.deed ?? t("aGoodDeed")}
        </p>
      </div>
      {view.seasonOpen ? <QrActions token={token} kidName={view.kidName} rate={formatCents(CENTS_PER_POINT)} /> : <Alert>{t("errors.seasonClosed")}</Alert>}
    </div>
  );
}

export default async function QrPage(props: PageProps<"/[locale]/d/[token]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <Card>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
