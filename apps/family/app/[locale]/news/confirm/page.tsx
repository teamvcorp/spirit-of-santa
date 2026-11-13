/**
 * /news/confirm?token=… (owner 2026-11-12): opened from the "confirm you want our news" email. Shows one button;
 * the Server Action checks the single-use token (not this page: no "valid/invalid" hint before acting).
 * Not indexed, and no referrer, so the token never leaks to another site.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";
import { NewsConfirmForm } from "./confirm-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("News.confirm");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Reading searchParams is request-time data: kept in a Suspense hole so the page shell stays prerendered. */
async function TokenForm({ searchParams }: { searchParams: PageProps<"/[locale]/news/confirm">["searchParams"] }) {
  const raw = (await searchParams).token;
  return <NewsConfirmForm token={typeof raw === "string" ? raw.slice(0, 100) : ""} />;
}

export default async function NewsConfirmPage({ searchParams }: PageProps<"/[locale]/news/confirm">) {
  const t = await getTranslations("News.confirm");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
        <Suspense fallback={null}>
          <TokenForm searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
