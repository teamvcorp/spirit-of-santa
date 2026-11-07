/**
 * /unsubscribe?t=<signed token> (Phase 7): opened from the "Stop emails like this" link in a
 * notification email. No sign-in. Opening the page changes NOTHING (email security scanners open
 * links automatically); the parent presses the button to confirm.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { readUnsubscribeToken } from "@repo/families/notifications";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { UnsubscribeForm } from "./unsubscribe-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notify");
  // no-referrer: the token is in the URL; never pass it to another site.
  return { title: t("unsubscribeTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Content({ searchParams }: { searchParams: PageProps<"/[locale]/unsubscribe">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).t;
  const token = typeof raw === "string" ? raw : "";
  const parsed = readUnsubscribeToken(token);
  const t = await getTranslations("Notify");
  if (!parsed) return <Alert tone="error">{t("badLink")}</Alert>;
  // "digest" is an unsubscribe scope (magic + deeds), not a setting: its label lives under scopes.
  const kindLabel = parsed.kind === "digest" ? t("scopes.digest") : t(`kinds.${parsed.kind}.label`);
  return (
    <>
      <p className="mb-4">{t("unsubscribeIntro", { kind: kindLabel })}</p>
      <UnsubscribeForm token={token} kindLabel={kindLabel} />
      <p className="mt-6 text-sm text-foreground/70">
        {t("manageHint")}{" "}
        <Link href="/parent/notifications" className="underline underline-offset-4">
          {t("manageLink")}
        </Link>
      </p>
    </>
  );
}

export default function UnsubscribePage(props: PageProps<"/[locale]/unsubscribe">) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <Suspense fallback={null}>
          <Title />
          <Content searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}

async function Title() {
  const t = await getTranslations("Notify");
  return <h1 className="mb-4 text-2xl font-bold">{t("unsubscribeTitle")}</h1>;
}
