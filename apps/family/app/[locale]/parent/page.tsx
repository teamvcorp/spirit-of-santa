import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card } from "@repo/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Parent");
  // Private pages: never indexed.
  return { title: t("title"), robots: { index: false, follow: false } };
}
import { listKids } from "@repo/families/kids";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { lockAction } from "./actions";
import { DeleteKidForm } from "./parent-forms";

async function Content() {
  await connection();
  const parent = await requireUnlockedPage();
  const [kids, t, locale] = await Promise.all([listKids(parent), getTranslations("Parent"), getLocale()]);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/parent/pin/setup" className="rounded-lg border border-current px-4 py-2 font-semibold">
            {t("changePin")}
          </Link>
          <form action={lockAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="rounded-lg border border-current px-4 py-2 font-semibold">
              {t("lock")}
            </button>
          </form>
        </div>
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("kidsTitle")}</h2>
          <Link href="/parent/kids/new" className="rounded-lg bg-brand-red px-4 py-2 font-semibold text-white hover:bg-brand-red-dark">
            {t("addKid")}
          </Link>
        </div>
        {kids.length === 0 ? (
          <p className="text-foreground/70">{t("noKids")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {kids.map((k) => (
              <li key={k.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Link href={`/parent/kids/${k.id}`} className="font-semibold underline underline-offset-4">
                    {k.firstName}
                  </Link>
                  <p className="text-sm text-foreground/70">{t("kidLine", { displayName: k.displayName, year: k.birthYear })}</p>
                  <span className="mt-1 inline-block rounded-full border border-foreground/30 px-2 text-xs">{k.registered ? t("registered") : t("awaiting")}</span>
                </div>
                <DeleteKidForm id={k.id} name={k.firstName} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-foreground/70">{t("awaitingNote")}</p>
      </Card>
    </>
  );
}

export default async function ParentPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
