/**
 * Record a good deed for a kid (parent + PIN). Creates the deed and its single-use QR code.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listDeedTypes, localized } from "@repo/deeds/catalog";
import { getKid } from "@repo/families/kids";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { RecordDeedForm } from "./deed-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Kid");
  return { title: t("recordTitle"), robots: { index: false, follow: false } };
}

async function Content({ params }: { params: PageProps<"/[locale]/kids/[id]/deed">["params"] }) {
  await connection();
  const parent = await requireUnlockedPage();
  const [kid, types, t, locale] = await Promise.all([getKid(parent, (await params).id), listDeedTypes({ activeOnly: true }), getTranslations("Kid"), getLocale()]);
  if (!kid) notFound();
  if (!kid.registered) return <Alert>{t("notRegistered")}</Alert>;
  const deeds = types.map((d) => ({ id: d.id, title: localized(d.title, locale) ?? "", description: localized(d.description, locale) }));
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{t("recordTitle")}</h1>
      <p className="mb-6 text-foreground/70">{t("recordIntro", { name: kid.firstName })}</p>
      <RecordDeedForm kidId={kid.id} deeds={deeds} />
    </>
  );
}

export default async function RecordDeedPage(props: PageProps<"/[locale]/kids/[id]/deed">) {
  const t = await getTranslations("Kid");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Link href="/" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
