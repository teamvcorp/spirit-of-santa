/**
 * /mfa/setup: turn on two-step sign-in (authenticator app). Every admin must do this before
 * anything else: requireRole() sends restricted sessions here (packages/auth/src/guards.ts).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireMfaSetupUser } from "@repo/auth";
import { beginMfaSetup } from "@repo/auth/mfa";
import { SignOutButton } from "@repo/auth/sign-out-button";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { MfaSetupForm } from "./mfa-setup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("MfaSetup");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection(); // session + a fresh secret: request-time only, never prerendered
  const user = await requireMfaSetupUser(authOptions);
  const [view, t] = await Promise.all([beginMfaSetup(user.id), getTranslations("MfaSetup")]);
  if (!view) notFound();
  if (view.status === "enabled") {
    // Turned on in this session (or another tab): this session must end and sign in with a code.
    return user.mfaSetup ? (
      <div className="flex flex-col gap-4">
        <Alert>{t("signInAgainNeeded")}</Alert>
        <SignOutButton label={t("signInAgain")} callbackUrl="/signin" />
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <Alert>{t("alreadyOn")}</Alert>
        <Link href="/" className="underline underline-offset-4">
          {t("backHome")}
        </Link>
      </div>
    );
  }
  return <MfaSetupForm qrDataUrl={view.qrDataUrl} manualKey={view.manualKey} issuer={view.issuer} account={view.account} />;
}

export default async function MfaSetupPage() {
  const t = await getTranslations("MfaSetup");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("intro")}</p>
        <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}
