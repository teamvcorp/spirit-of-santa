import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";
import { hasParentPin } from "@repo/auth/parent-pin";
import { goTo, requireParent } from "@/lib/parent";
import { UnlockForm } from "../parent-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("unlockTitle"), robots: { index: false, follow: false } };
}

async function Guarded() {
  await connection();
  const parent = await requireParent();
  if (!(await hasParentPin(parent))) await goTo("/parent/pin/setup");
  return <UnlockForm />;
}

export default async function UnlockPage() {
  const t = await getTranslations("Parent");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{t("unlockTitle")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("unlockIntro")}</p>
        <Suspense fallback={null}>
          <Guarded />
        </Suspense>
      </Card>
    </main>
  );
}
