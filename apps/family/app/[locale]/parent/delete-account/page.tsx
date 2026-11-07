/**
 * /parent/delete-account (Phase 8, COPPA deletion right). PIN required. Says exactly what will happen with
 * this family's real numbers BEFORE asking for the password; the deletion itself: @repo/families/erase.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DELIVER_THEN_DELETE_DAYS, erasePreview } from "@repo/families/erase";
import { formatPoints } from "@repo/lib/format";
import { intlLocale } from "@repo/lib/locales";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { DeleteAccountForm } from "../parent-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DeleteAccount");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage("/parent/delete-account");
  const [preview, t, locale] = await Promise.all([erasePreview(parent), getTranslations("DeleteAccount"), getLocale()]);
  if (!preview) return <Alert tone="error">{t("errors.notFound")}</Alert>;
  return (
    <>
      <ul className="mb-4 list-disc pl-5 text-sm" data-testid="erase-preview">
        <li>{t("willDelete", { children: preview.children })}</li>
        {preview.magicCentipoints > 0 && <li>{t("willGiveMagic", { magic: formatPoints(preview.magicCentipoints, intlLocale(locale)) })}</li>}
        {preview.giftsOnTheirWay > 0 && !preview.canDeliverFirst && (
          // No usable address: the gift can't be sent. Say so, and how to get it (add the address first).
          <li data-testid="gifts-kept">
            {t("willKeepGifts", { count: preview.giftsOnTheirWay })}{" "}
            <Link href="/parent/address" className="underline underline-offset-4">
              {t("addAddressFirst")}
            </Link>
          </li>
        )}
        <li>{t("willKeepRecords")}</li>
      </ul>
      <Alert tone="error">{t("cannotUndo")}</Alert>
      <div className="mt-4">
        <DeleteAccountForm giftsOnTheirWay={preview.canDeliverFirst ? preview.giftsOnTheirWay : 0} days={DELIVER_THEN_DELETE_DAYS} />
      </div>
    </>
  );
}

export default async function DeleteAccountPage() {
  const t = await getTranslations("DeleteAccount");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        <p className="mb-4 text-muted">{t("intro")}</p>
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}
