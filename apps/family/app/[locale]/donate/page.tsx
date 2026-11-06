/**
 * /donate: public community / corporate gifts (Phase 5 slice 2). No account needed.
 * States the rules plainly before anyone gives (user decisions 2026-11-06): pooled, shared
 * EQUALLY among registered kids at the freeze, the platform fee %, and the 501(c)(3) receipt
 * (only mentioned once receipts are switched on in admin). Open only while the season is open
 * AND an admin has set the fee.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents } from "@repo/lib/format";
import { donationWindow, seasonDonationTotal } from "@repo/payments/community";
import { getPlatformSettings } from "@repo/payments/settings";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CommunityDonateForm } from "./donate-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Community");
  return { title: t("title"), description: t("intro") };
}

/** 1250 basis points → "12.5%" (en) / "12,5 %" (es). */
const percent = (bps: number, locale: string) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(bps / 10_000);

async function Content() {
  await connection();
  const [settings, win, total, t, locale] = await Promise.all([getPlatformSettings(), donationWindow(), seasonDonationTotal(), getTranslations("Community"), getLocale()]);
  // The freeze moment is Central-Time midnight: show that calendar day in the page language.
  const intlLocale = locale === "es" ? "es-US" : "en-US";
  const shareDay = new Intl.DateTimeFormat(intlLocale, { month: "long", day: "numeric", timeZone: "America/Chicago" }).format(win.freezeAt);
  const open = win.open && settings.donationFeeBps !== null;
  return (
    <div className="flex flex-col gap-4">
      {settings.donationFeeBps !== null && (
        <p>{t("how", { day: shareDay, fee: percent(settings.donationFeeBps, intlLocale), rate: formatCents(CENTS_PER_POINT) })}</p>
      )}
      {settings.receiptsReady && (
        <p className="text-sm text-foreground/70">{t("charity", { orgName: settings.charity.legalName, ein: settings.charity.ein })}</p>
      )}
      {total.cents > 0 && <p className="font-semibold" data-testid="season-total">{t("raised", { amount: formatCents(total.cents) })}</p>}
      {open ? <CommunityDonateForm /> : <Alert>{t("errors.closed")}</Alert>}
    </div>
  );
}

export default function CommunityDonatePage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <Heading />
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}

async function Heading() {
  const t = await getTranslations("Community");
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>
    </>
  );
}
