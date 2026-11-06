/**
 * /parent/register: pay the $5-per-child registration that verifies parental consent (COPPA).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listKids } from "@repo/families/kids";
import { REGISTRATION_FEE_CENTS } from "@repo/lib/limits";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { RegisterKidsForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Register");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage();
  const [kids, t] = await Promise.all([listKids(parent), getTranslations("Register")]);
  const awaiting = kids.filter((k) => !k.registered).map((k) => ({ id: k.id, firstName: k.firstName }));
  if (awaiting.length === 0) return <p className="text-foreground/70">{t("nothingToDo")}</p>;
  return <RegisterKidsForm kids={awaiting} feeCents={REGISTRATION_FEE_CENTS} />;
}

export default async function RegisterKidsPage() {
  const t = await getTranslations("Register");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 text-foreground/70">{t("intro")}</p>
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}
