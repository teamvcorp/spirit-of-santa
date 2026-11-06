/** Stripe returns here after a donation. Shows only what our Payment record says. */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { donationStatus } from "@repo/deeds/donate";
import { publicLimit } from "@repo/deeds/public";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Donate");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status(props: PageProps<"/[locale]/k/[token]/thanks">) {
  await connection();
  const [{ token }, sp, t] = await Promise.all([props.params, props.searchParams, getTranslations("Donate")]);
  if (!(await publicLimit(await headers(), "view", 120))) return <Alert tone="error">{t("errors.rateLimited")}</Alert>;
  const s = await donationStatus(token, typeof sp.session_id === "string" ? sp.session_id : "");
  const msg = s === "credited" ? t("credited") : s === "processing" ? t("processing") : s === "review" ? t("review") : s === "open" ? t("notPaid") : t("invalid");
  return <Alert tone={s === "credited" || s === "processing" ? "info" : "error"}>{msg}</Alert>;
}

export default async function DonateThanksPage(props: PageProps<"/[locale]/k/[token]/thanks">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <Card>
        <Suspense fallback={null}>
          <Status {...props} />
        </Suspense>
      </Card>
    </main>
  );
}
