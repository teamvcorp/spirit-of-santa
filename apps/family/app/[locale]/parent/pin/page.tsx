import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";
import { hasParentPin } from "@repo/auth/parent-pin";
import { goTo, requireParent, safeNext } from "@/lib/parent";
import { UnlockForm } from "../parent-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("unlockTitle"), robots: { index: false, follow: false } };
}

async function Guarded({ searchParams }: { searchParams: PageProps<"/[locale]/parent/pin">["searchParams"] }) {
  await connection();
  const parent = await requireParent();
  const next = safeNext((await searchParams).next) ?? undefined; // validated: family-app paths only
  if (!(await hasParentPin(parent))) await goTo(next ? `/parent/pin/setup?next=${encodeURIComponent(next)}` : "/parent/pin/setup");
  return <UnlockForm next={next} />;
}

export default async function UnlockPage(props: PageProps<"/[locale]/parent/pin">) {
  const t = await getTranslations("Parent");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{t("unlockTitle")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("unlockIntro")}</p>
        <Suspense fallback={null}>
          <Guarded searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
