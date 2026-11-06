import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";
import { goTo, requireParent } from "@/lib/parent";
import { hasParentPin, isParentUnlocked } from "@repo/auth/parent-pin";
import { PinSetupForm } from "../../parent-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("setupTitle"), robots: { index: false, follow: false } };
}

/** First PIN (no PIN yet) or change it (only while unlocked). Both need the account password. */
async function Guarded() {
  await connection();
  const parent = await requireParent();
  if (!(await isParentUnlocked(parent)) && (await hasParentPin(parent))) await goTo("/parent/pin");
  return <PinSetupForm />;
}

export default async function PinSetupPage() {
  const t = await getTranslations("Parent");
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{t("setupTitle")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("setupIntro")}</p>
        <Suspense fallback={null}>
          <Guarded />
        </Suspense>
      </Card>
    </main>
  );
}
