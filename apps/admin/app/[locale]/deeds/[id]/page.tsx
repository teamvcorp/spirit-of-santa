import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { getDeedType } from "@repo/deeds/catalog";
import { centsToInput } from "@repo/lib/format";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { DeedForm } from "../deed-ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deeds");
  return { title: t("editTitle"), robots: { index: false, follow: false } };
}

/** Cents -> the dollars text shown in the form ("5.00", "12.50"), same helper as store prices. */
const dollars = (c?: number) => (c == null ? "" : centsToInput(c));

async function Content({ params }: { params: PageProps<"/[locale]/deeds/[id]">["params"] }) {
  await connection();
  await requireRole(authOptions, "admin");
  const d = await getDeedType((await params).id);
  if (!d) notFound();
  return (
    <DeedForm
      id={d.id}
      version={d.version}
      initial={{ titleEn: d.title.en, titleEs: d.title.es ?? "", descriptionEn: d.description.en ?? "", descriptionEs: d.description.es ?? "", tipMin: dollars(d.tipMinCents), tipMax: dollars(d.tipMaxCents) }}
    />
  );
}

export default async function EditDeedPage(props: PageProps<"/[locale]/deeds/[id]">) {
  const t = await getTranslations("Deeds");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Link href="/deeds" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-4 text-2xl font-bold">{t("editTitle")}</h1>
        <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
          <Content params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
