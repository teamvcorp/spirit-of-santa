import type { Metadata } from "next";
import { locale as rootLocale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { peekStoreInvite } from "@repo/auth/account-flows";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { acceptInviteAction } from "../account-actions";
import { AcceptInviteForm } from "./accept-invite-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AcceptInvitePage");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Request-time part: reads ?token and looks up the invite (inside Suspense). */
async function InviteSlot({ searchParams, signInHref }: { searchParams: PageProps<"/[locale]/accept-invite">["searchParams"]; signInHref: string }) {
  const t = await getTranslations("AcceptInvitePage");
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 100) : "";
  // Peek only (doesn't use the token): shows which store is invited.
  const invite = await peekStoreInvite(token);
  if (!invite) return <Alert tone="error">{t("invalid")}</Alert>;
  return (
    <>
      <p className="mb-6 mt-1 text-foreground/70">{t("intro", { storeName: invite.storeName })}</p>
      <AcceptInviteForm action={acceptInviteAction} token={token} email={invite.email} signInHref={signInHref} />
    </>
  );
}

export default async function AcceptInvitePage({ searchParams }: PageProps<"/[locale]/accept-invite">) {
  const t = await getTranslations("AcceptInvitePage");
  const locale = await rootLocale();
  const signInHref = localizePath("/signin", isLocale(locale) ? locale : DEFAULT_LOCALE);
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Suspense fallback={null}>
          <InviteSlot searchParams={searchParams} signInHref={signInHref} />
        </Suspense>
      </Card>
    </main>
  );
}