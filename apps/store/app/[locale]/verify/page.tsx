import type { Metadata } from "next";
import { locale as rootLocale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TokenFormSlot } from "@repo/auth/token-slot";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { Card } from "@repo/ui/card";
import { confirmEmailAction } from "../account-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.accounts.verify");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function VerifyPage({ searchParams }: PageProps<"/[locale]/verify">) {
  const t = await getTranslations("Common.accounts.verify");
  const locale = await rootLocale();
  const signInHref = localizePath("/signin", isLocale(locale) ? locale : DEFAULT_LOCALE);
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
        <Suspense fallback={null}>
          <TokenFormSlot searchParams={searchParams} kind="verify" action={confirmEmailAction} signInHref={signInHref} />
        </Suspense>
      </Card>
    </main>
  );
}