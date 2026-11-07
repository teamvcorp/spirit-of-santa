/**
 * /parent/notifications (Phase 7): which emails the parent gets. PIN required. Account emails
 * (sign-in, receipts, "gift on its way") are always sent; these three kinds can be switched off.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getNotifyPrefs } from "@repo/families/notifications";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { NotifyForm } from "./notify-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notify");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage("/parent/notifications");
  const [prefs, t] = await Promise.all([getNotifyPrefs(parent), getTranslations("Notify")]);
  if (!prefs) return <Alert tone="error">{t("errors.notFound")}</Alert>;
  return <NotifyForm prefs={prefs} />;
}

export default async function NotificationsPage() {
  const t = await getTranslations("Notify");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 text-muted">{t("intro")}</p>
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}
