import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("addTitle"), robots: { index: false, follow: false } };
}
import { birthYearRange } from "@repo/families/schemas";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { KidForm } from "../../parent-forms";

async function Guarded() {
  await connection();
  await requireUnlockedPage();
  const { min, max } = birthYearRange();
  return <KidForm initial={{ firstName: "", birthYear: "", displayName: "" }} minYear={min} maxYear={max} />;
}

export default async function NewKidPage() {
  const t = await getTranslations("Parent");
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("addTitle")}</h1>
        <Suspense fallback={null}>
          <Guarded />
        </Suspense>
      </Card>
    </main>
  );
}
