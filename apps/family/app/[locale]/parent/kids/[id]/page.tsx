import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";
import { notFound } from "next/navigation";
import { getKid } from "@repo/families/kids";
import { birthYearRange } from "@repo/families/schemas";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { KidForm } from "../../parent-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("editTitle"), robots: { index: false, follow: false } };
}

async function Guarded({ params }: { params: PageProps<"/[locale]/parent/kids/[id]">["params"] }) {
  await connection();
  const parent = await requireUnlockedPage();
  const kid = await getKid(parent, (await params).id);
  if (!kid) notFound(); // other families' kids look the same as missing ones
  const { min, max } = birthYearRange();
  return <KidForm id={kid.id} initial={{ firstName: kid.firstName, birthYear: String(kid.birthYear), displayName: kid.displayName, itemCap: String(kid.itemCap) }} minYear={min} maxYear={max} />;
}

export default async function EditKidPage(props: PageProps<"/[locale]/parent/kids/[id]">) {
  const t = await getTranslations("Parent");
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("editTitle")}</h1>
        <Suspense fallback={null}>
          <Guarded params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
