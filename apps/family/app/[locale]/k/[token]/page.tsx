/**
 * /k/<token>: a kid's shareable donation page (no deed). PUBLIC (no account). Shows only the kid's
 * DISPLAY NAME (+ approved family nickname). Never indexed; no referrer (the token is in the URL).
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getDonationPage } from "@repo/deeds/donate";
import { publicLimit } from "@repo/deeds/public";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { DonateForm } from "./donate-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Donate");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Content({ params }: { params: PageProps<"/[locale]/k/[token]">["params"] }) {
  await connection();
  const [{ token }, t] = await Promise.all([params, getTranslations("Donate")]);
  if (!(await publicLimit(await headers(), "view", 120))) return <Alert tone="error">{t("errors.rateLimited")}</Alert>;
  const page = await getDonationPage(token);
  if (page.state !== "open") return <Alert tone="error">{t("invalid")}</Alert>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold" data-testid="kid-name">
        {t("heading", { name: page.kidName })}
      </h1>
      {page.familyAlias && <p className="text-muted">{t("family", { family: page.familyAlias })}</p>}
      <p>{t("intro", { name: page.kidName })}</p>
      {page.seasonOpen ? <DonateForm token={token} /> : <Alert>{t("errors.seasonClosed")}</Alert>}
    </div>
  );
}

export default async function DonatePage(props: PageProps<"/[locale]/k/[token]">) {
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
