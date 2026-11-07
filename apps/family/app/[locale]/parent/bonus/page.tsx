/**
 * /parent/bonus: "bonus magic". A parent pays and the points go to one of their registered kids
 * (Phase 5 slice 1; @repo/families/bonus). Needs the PIN unlock. `?kid=<id>` preselects a child.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listKids } from "@repo/families/kids";
import { formatCents } from "@repo/lib/format";
import { giftWindow } from "@repo/stores/season";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { BonusForm } from "./bonus-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Bonus");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content({ searchParams }: { searchParams: PageProps<"/[locale]/parent/bonus">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const kidParam = typeof sp.kid === "string" ? sp.kid : "";
  const parent = await requireUnlockedPage(`/parent/bonus${/^[a-f0-9]{24}$/.test(kidParam) ? `?kid=${kidParam}` : ""}`);
  const [kids, win, t] = await Promise.all([listKids(parent), giftWindow(), getTranslations("Bonus")]);
  const registered = kids.filter((k) => k.registered).map((k) => ({ id: k.id, firstName: k.firstName }));
  if (registered.length === 0) return <p className="text-muted">{t("noKids")}</p>;
  if (!win.open) return <Alert>{t("errors.seasonClosed")}</Alert>;
  const preselect = typeof sp.kid === "string" && registered.some((k) => k.id === sp.kid) ? sp.kid : undefined;
  return <BonusForm kids={registered} preselect={preselect} />;
}

export default async function BonusPage(props: PageProps<"/[locale]/parent/bonus">) {
  const t = await getTranslations("Bonus");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        {/* Rate from the server constant (never hard-coded). */}
        <p className="mb-6 text-muted">{t("intro", { rate: formatCents(CENTS_PER_POINT) })}</p>
        <Suspense fallback={null}>
          <Content searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
