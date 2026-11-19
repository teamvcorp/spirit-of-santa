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
import { STORE_GIFT_PRESETS_CENTS } from "@repo/lib/limits";
import { donationWindow, seasonDonationTotal } from "@repo/payments/community";
import { getPlatformSettings } from "@repo/payments/settings";
import { peekStoreGift } from "@repo/stores/store-gifts";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { intlLocale as toIntlLocale } from "@repo/lib/locales";
import { CommunityDonateForm } from "./donate-form";
import { SeasonGate } from "@/components/season-gate";
import { HiddenElf } from "@/components/hidden-elf";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Community");
  return { title: t("title"), description: t("intro") };
}

/** 1250 basis points → "12.5%" (en) / "12,5 %" (es). */
const percent = (bps: number, locale: string) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(bps / 10_000);

type Props = PageProps<"/[locale]/donate">;

async function Content({ searchParams }: Pick<Props, "searchParams">) {
  await connection();
  // ?store=<token>: a store giving as itself through its single-use gift link (founding partners slice 3).
  const raw = (await searchParams).store;
  const storeToken = typeof raw === "string" ? raw.slice(0, 100) : undefined;
  const [settings, win, total, t, locale, store] = await Promise.all([
    getPlatformSettings(),
    donationWindow(),
    seasonDonationTotal(),
    getTranslations("Community"),
    getLocale(),
    storeToken ? peekStoreGift(storeToken) : null,
  ]);
  // The freeze moment is Central-Time midnight: show that calendar day in the page language.
  const intlLocale = toIntlLocale(locale);
  const shareDay = new Intl.DateTimeFormat(intlLocale, { month: "long", day: "numeric", timeZone: "America/Chicago" }).format(win.freezeAt);
  // The acknowledgment box names the charity: no name set → no gifts (the action refuses too).
  const open = win.open && settings.donationFeeBps !== null && settings.charity.legalName !== "";
  return (
    <div className="flex flex-col gap-4">
      {settings.donationFeeBps !== null && (
        <p>{t("how", { day: shareDay, fee: percent(settings.donationFeeBps, intlLocale), rate: formatCents(CENTS_PER_POINT) })}</p>
      )}
      {settings.receiptsReady && (
        <p className="text-sm text-muted">{t("charity", { orgName: settings.charity.legalName, ein: settings.charity.ein })}</p>
      )}
      {total.cents > 0 && <p className="font-semibold" data-testid="season-total">{t("raised", { amount: formatCents(total.cents) })}</p>}
      {storeToken && !store && <Alert tone="error">{t("storeLinkInvalid")}</Alert>}
      {store && (
        <div className="flex flex-col gap-1 rounded-xl border border-accent p-3" data-testid="store-gift">
          <p className="font-semibold">{t("givingAs", { store: store.storeName })}</p>
          <p className="text-sm text-muted">{t("storeGiftNote", { amount: formatCents(STORE_GIFT_PRESETS_CENTS[0]) })}</p>
        </div>
      )}
      {/* A store link that no longer works: NO public form here, or the store could give without credit (review
          2026-11-19). They ask for a fresh link instead. */}
      {storeToken && !store ? null : open ? (
        <CommunityDonateForm orgName={settings.charity.legalName} {...(store && storeToken ? { storeToken } : {})} />
      ) : (
        <Alert>{t("errors.closed")}</Alert>
      )}
    </div>
  );
}

export default function CommunityDonatePage({ searchParams }: Props) {
  return (
    <main className="relative mx-auto w-full max-w-xl flex-1 p-6">
      <SeasonGate>
        <Card>
          <Heading />
          <Suspense fallback={null}>
            <Content searchParams={searchParams} />
          </Suspense>
        </Card>
      </SeasonGate>
      <HiddenElf page="donate" />
    </main>
  );
}

async function Heading() {
  const t = await getTranslations("Community");
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-muted">{t("intro")}</p>
    </>
  );
}
