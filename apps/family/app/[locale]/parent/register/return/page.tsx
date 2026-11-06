/**
 * Stripe sends the parent back here after paying. We only SHOW the session status (checked
 * server-side, and only for this family's own session); the webhook does the registering.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { registrationSessionStatus } from "@repo/families/registration";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Register");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status({ searchParams }: { searchParams: PageProps<"/[locale]/parent/register/return">["searchParams"] }) {
  await connection();
  // Signed-in parent only, NOT the PIN unlock: the unlock is 15 min + a SameSite=strict cookie, so
  // the redirect back from Stripe can arrive "locked" and would lose the session id. This page only
  // shows the status of the family's OWN session (checked against Stripe's metadata).
  const parent = await requireParent();
  const sid = (await searchParams).session_id;
  const status = typeof sid === "string" ? await registrationSessionStatus(parent, sid) : null;
  const t = await getTranslations("Register");
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={status === "registered" || status === "processing" ? "info" : "error"}>
        {status === "registered" ? t("paid") : status === "processing" ? t("processing") : status === "review" ? t("review") : status === "open" ? t("notPaid") : t("unknown")}
      </Alert>
      <Link href={status === "open" ? "/parent/register" : "/parent"} className="underline underline-offset-4">
        {status === "open" ? t("tryAgain") : t("back")}
      </Link>
    </div>
  );
}

export default async function RegisterReturnPage(props: PageProps<"/[locale]/parent/register/return">) {
  const t = await getTranslations("Register");
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
