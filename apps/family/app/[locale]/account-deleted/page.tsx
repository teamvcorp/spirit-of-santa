/**
 * /account-deleted (Phase 8): where the browser lands after a parent deleted the family account. Static and
 * public: it shows nothing about anyone (the account no longer exists).
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card } from "@repo/ui/card";
import { buttonClass } from "@repo/ui/button";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountDeleted");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AccountDeletedPage() {
  const t = await getTranslations("AccountDeleted");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 whitespace-pre-line text-muted">{t("body")}</p>
        <Link href="/" className={buttonClass("primary")}>
          {t("home")}
        </Link>
      </Card>
    </main>
  );
}
