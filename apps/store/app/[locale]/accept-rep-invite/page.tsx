import type { Metadata } from "next";
import { locale as rootLocale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { peekRepInvite } from "@repo/auth/account-flows";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { acceptRepInviteAction } from "../account-actions";
import { RepInviteForm } from "./rep-invite-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AcceptRepInvitePage");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function InviteSlot({ searchParams, signInHref }: { searchParams: PageProps<"/[locale]/accept-rep-invite">["searchParams"]; signInHref: string }) {
  const t = await getTranslations("AcceptRepInvitePage");
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 100) : "";
  const invite = await peekRepInvite(token); // look only; the token is used on submit
  if (!invite) return <Alert tone="error">{t("invalid")}</Alert>;
  return (
    <>
      <p className="mb-6 mt-1 text-muted">{t("intro", { storeName: invite.storeName })}</p>
      <RepInviteForm action={acceptRepInviteAction} token={token} email={invite.email} signInHref={signInHref} />
    </>
  );
}

export default async function AcceptRepInvitePage({ searchParams }: PageProps<"/[locale]/accept-rep-invite">) {
  const t = await getTranslations("AcceptRepInvitePage");
  const locale = await rootLocale();
  const signInHref = localizePath("/signin", isLocale(locale) ? locale : DEFAULT_LOCALE);
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Suspense fallback={null}>
          <InviteSlot searchParams={searchParams} signInHref={signInHref} />
        </Suspense>
      </Card>
    </main>
  );
}