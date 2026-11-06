import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmailRequestForm } from "@repo/auth/forms";
import { Card } from "@repo/ui/card";
import { resendVerificationAction } from "../../account-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.accounts.resend");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ResendVerificationPage() {
  const t = await getTranslations("Common.accounts.resend");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("intro")}</p>
        <EmailRequestForm action={resendVerificationAction} mode="resend" />
      </Card>
    </main>
  );
}