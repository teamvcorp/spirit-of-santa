/** Stripe returns here after a tip. Shows only what's true (our Payment record decides). */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { headers } from "next/headers";
import { publicLimit, tipStatus } from "@repo/deeds/public";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Qr");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status(props: PageProps<"/[locale]/d/[token]/thanks">) {
  await connection();
  const [{ token }, sp, t] = await Promise.all([props.params, props.searchParams, getTranslations("Qr")]);
  // Each check costs a Stripe API call: same per-visitor limit as the QR page itself.
  if (!(await publicLimit(await headers(), "view", 120))) return <Alert tone="error">{t("errors.rateLimited")}</Alert>;
  const sid = typeof sp.session_id === "string" ? sp.session_id : "";
  const s = await tipStatus(token, sid);
  const msg = s === "credited" ? t("tipCredited") : s === "processing" ? t("tipProcessing") : s === "review" ? t("tipReview") : s === "open" ? t("tipNotPaid") : t("invalid");
  return <Alert tone={s === "credited" || s === "processing" ? "info" : "error"}>{msg}</Alert>;
}

export default async function TipThanksPage(props: PageProps<"/[locale]/d/[token]/thanks">) {
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
