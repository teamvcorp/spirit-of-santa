/**
 * Stripe sends the parent back here after a pay-up. payUpStatus checks the session with Stripe
 * (this family's pay-up sessions only) and records a paid one right away (same idempotent handler
 * as the webhook). Signed-in parent only, NOT the PIN unlock (see the bonus return page: the
 * unlock cookie may not survive the redirect back from Stripe).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { payUpStatus } from "@repo/families/payup";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PayUp");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status({ searchParams }: { searchParams: PageProps<"/[locale]/parent/payup/return">["searchParams"] }) {
  await connection();
  const parent = await requireParent();
  const sid = (await searchParams).session_id;
  const status = typeof sid === "string" ? await payUpStatus(parent, sid) : null;
  const t = await getTranslations("PayUp");
  const msg = status === "credited" ? t("credited") : status === "processing" ? t("processing") : status === "review" ? t("review") : status === "open" ? t("notPaid") : t("unknown");
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={status === "credited" || status === "processing" ? "info" : "error"}>{msg}</Alert>
      <Link href={status === "open" ? "/parent/payup" : "/parent"} className="underline underline-offset-4">
        {status === "open" ? t("tryAgain") : t("back")}
      </Link>
    </div>
  );
}

export default async function PayUpReturnPage(props: PageProps<"/[locale]/parent/payup/return">) {
  const t = await getTranslations("PayUp");
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
