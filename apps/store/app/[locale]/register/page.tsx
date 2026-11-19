/**
 * Store sign-up, EMAIL FIRST (owner 2026-11-19: protection against bots and fake accounts).
 *  - /register            → step 1: just the email. We send a "Register your store" link; nothing is created.
 *  - /register?token=…    → step 2: the full form (the email comes from the link, already proven).
 * An unused link (and its address) is deleted after 14 days. Rules: @repo/auth/account-flows requestStoreSignup /
 * completeStoreSignup.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { peekStoreSignup } from "@repo/auth/account-flows";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { completeStoreSignupAction, requestStoreSignupAction } from "../account-actions";
import { EmailStepForm } from "./email-step-form";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RegisterPage");
  // referrer: the step-2 URL carries the secret link token: never leak it to other sites.
  return { title: t("title"), description: t("intro"), referrer: "no-referrer" };
}

/** Request-time part: reads ?token (inside Suspense). */
async function Step({ searchParams }: { searchParams: PageProps<"/[locale]/register">["searchParams"] }) {
  await connection(); // request-time only: link checks read the clock (never during prerender)
  const t = await getTranslations("RegisterPage");
  const raw = (await searchParams).token;
  if (raw === undefined) return <EmailStepForm action={requestStoreSignupAction} />;
  const token = typeof raw === "string" ? raw.slice(0, 100) : "";
  // Peek only (doesn't use the link up): shows which email is signing up.
  const signup = await peekStoreSignup(token);
  if (!signup) {
    return (
      <>
        <Alert tone="error" className="mb-6">
          {t("linkInvalid")}
        </Alert>
        <EmailStepForm action={requestStoreSignupAction} />
      </>
    );
  }
  if (signup.state === "done") {
    return (
      <Alert>
        <strong className="block">{t("doneTitle")}</strong>
        {t("doneBody")}{" "}
        <Link href="/signin" className="font-semibold underline underline-offset-4">
          {t("signIn")}
        </Link>
      </Alert>
    );
  }
  return <RegisterForm action={completeStoreSignupAction} token={token} email={signup.email} />;
}

export default async function RegisterPage({ searchParams }: PageProps<"/[locale]/register">) {
  const t = await getTranslations("RegisterPage");
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 mt-1 text-muted">{t("intro")}</p>
        <Suspense fallback={null}>
          <Step searchParams={searchParams} />
        </Suspense>
        <p className="mt-6 text-sm">
          {t("haveAccount")}{" "}
          <Link href="/signin" className="font-semibold underline underline-offset-4">
            {t("signIn")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
