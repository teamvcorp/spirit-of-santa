/**
 * Stripe sends the donor back here. communityDonationStatus asks Stripe about THIS session and
 * records a paid one right away (same idempotent handler as the webhook, which also creates the
 * receipt). The session id in the URL is the only key: the page shows nothing but its status.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { publicLimit } from "@repo/deeds/public";
import { communityDonationStatus } from "@repo/payments/community";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Community");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status({ searchParams }: { searchParams: PageProps<"/[locale]/donate/thanks">["searchParams"] }) {
  await connection();
  const t = await getTranslations("Community");
  if (!(await publicLimit(await headers(), "view", 120))) return <Alert tone="error">{t("errors.rateLimited")}</Alert>;
  const sid = (await searchParams).session_id;
  const s = typeof sid === "string" ? await communityDonationStatus(sid) : null;
  const msg = s === "received" ? t("received") : s === "processing" ? t("processing") : s === "review" ? t("review") : s === "open" ? t("notPaid") : t("unknown");
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={s === "received" || s === "processing" ? "info" : "error"}>{msg}</Alert>
      <Link href="/donate" className="underline underline-offset-4">
        {s === "open" ? t("tryAgain") : t("back")}
      </Link>
    </div>
  );
}

export default async function CommunityThanksPage(props: PageProps<"/[locale]/donate/thanks">) {
  const t = await getTranslations("Community");
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
