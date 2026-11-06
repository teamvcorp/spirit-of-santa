/**
 * Stripe sends the parent back here after paying a bonus. bonusStatus checks the session with
 * Stripe (this family's bonus sessions only) and records a paid one right away (same idempotent
 * handler as the webhook), so the points show even if the webhook is late.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { bonusStatus } from "@repo/families/bonus";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Bonus");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status({ searchParams }: { searchParams: PageProps<"/[locale]/parent/bonus/return">["searchParams"] }) {
  await connection();
  const parent = await requireUnlockedPage();
  const sid = (await searchParams).session_id;
  const status = typeof sid === "string" ? await bonusStatus(parent, sid) : null;
  const t = await getTranslations("Bonus");
  const msg = status === "credited" ? t("credited") : status === "processing" ? t("processing") : status === "review" ? t("review") : status === "open" ? t("notPaid") : t("unknown");
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={status === "credited" || status === "processing" ? "info" : "error"}>{msg}</Alert>
      <Link href={status === "open" ? "/parent/bonus" : "/parent"} className="underline underline-offset-4">
        {status === "open" ? t("tryAgain") : t("back")}
      </Link>
    </div>
  );
}

export default async function BonusReturnPage(props: PageProps<"/[locale]/parent/bonus/return">) {
  const t = await getTranslations("Bonus");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
        <Suspense fallback={null}>
          <Status searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
