import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { DeedForm } from "../deed-ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deeds");
  return { title: t("newTitle"), robots: { index: false, follow: false } };
}

async function Guarded() {
  await connection();
  await requireRole(authOptions, "admin");
  return <DeedForm initial={{ titleEn: "", titleEs: "", descriptionEn: "", descriptionEs: "", tipMin: "", tipMax: "" }} />;
}

export default async function NewDeedPage() {
  const t = await getTranslations("Deeds");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Link href="/deeds" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("newTitle")}</h1>
        <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
          <Guarded />
        </Suspense>
      </Card>
    </main>
  );
}
