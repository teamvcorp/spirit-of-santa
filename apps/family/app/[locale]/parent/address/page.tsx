/**
 * /parent/address (Phase 6 slice 4b): where Spirit O Santa sends funded gifts. PIN required.
 * Only asked for while a gift is on its way; stored encrypted; deleted once every gift is delivered
 * (@repo/families/address explains the data-minimisation rules).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { addressState } from "@repo/families/address";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { AddressForm, DeleteAddressForm } from "./address-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Address");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage("/parent/address");
  const [state, t] = await Promise.all([addressState(parent), getTranslations("Address")]);
  if (!state) return <Alert tone="error">{t("errors.notFound")}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      {state.unreadable && <Alert tone="error">{t("unreadable")}</Alert>}
      {state.needed ? (
        <AddressForm saved={state.saved} />
      ) : (
        <p className="text-foreground/70" data-testid="not-needed">{t("notNeeded")}</p>
      )}
      {(state.saved || state.unreadable) && (
        <div className="border-t border-foreground/10 pt-4">
          <p className="mb-2 text-sm text-foreground/70">{t("deleteHelp")}</p>
          <DeleteAddressForm />
        </div>
      )}
    </div>
  );
}

export default async function AddressPage() {
  const t = await getTranslations("Address");
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
