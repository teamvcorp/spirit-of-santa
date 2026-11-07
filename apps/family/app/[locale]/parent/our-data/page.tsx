/**
 * /parent/our-data (Phase 8 slice 2b, COPPA): everything Spirit of Santa stores about this family and each child,
 * in plain language, plus a JSON download. PIN required. Data: @repo/families/data-export (one source for both).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { familyDataExport } from "@repo/families/data-export";
import { formatPoints } from "@repo/lib/format";
import { intlLocale } from "@repo/lib/locales";
import { localizePath } from "@repo/i18n/paths";
import { Alert } from "@repo/ui/alert";
import { buttonClass } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("OurData");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage("/parent/our-data");
  const [locale, t] = await Promise.all([getLocale(), getTranslations("OurData")]);
  const data = await familyDataExport(parent, locale);
  if (!data) return <Alert tone="error">{t("notFound")}</Alert>;
  const il = intlLocale(locale);
  const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString(il, { dateStyle: "medium", timeZone: "America/Chicago" }) : t("none"));
  const pts = (c: number) => t("magic", { magic: formatPoints(c, il) });
  const yes = (b: boolean) => (b ? t("yes") : t("no"));
  const a = data.family.deliveryAddress;
  return (
    <div className="flex flex-col gap-6">
      <a href={localizePath("/parent/our-data/download", locale)} className={buttonClass("primary", "self-start")} data-testid="download" download>
        {t("download")}
      </a>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("parentTitle")}</h2>
        <dl>
          <Row label={t("email")} value={data.parent.email} />
          <Row label={t("name")} value={data.parent.name ?? t("none")} />
          <Row label={t("language")} value={data.parent.language === "es" ? "Español" : "English"} />
          <Row label={t("created")} value={day(data.parent.accountCreated)} />
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("familyTitle")}</h2>
        <dl>
          <Row label={t("familyName")} value={data.family.familyName} />
          <Row label={t("alias")} value={data.family.publicAlias ? `${data.family.publicAlias} (${data.family.showAliasPublicly ? t("shown") : t("hidden")})` : t("none")} />
          <Row label={t("zip")} value={data.family.zip ?? t("none")} />
          <Row
            label={t("address")}
            value={a ? [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join(", ") : data.family.deliveryAddressUnreadable ? t("addressUnreadable") : t("none")}
          />
          <Row label={t("emails")} value={Object.entries(data.family.emailSettings).map(([k, on]) => `${t(`emailKinds.${k}` as never)}: ${yes(on)}`).join(" · ")} />
          <Row label={t("consent")} value={t("consentValue", { version: data.family.consent.version ?? "—", date: day(data.family.consent.acceptedAt) })} />
          <Row label={t("pin")} value={yes(data.family.pinSet)} />
        </dl>
      </Card>
      <Card data-testid="payments">
        <h2 className="mb-2 text-lg font-semibold">{t("paymentsTitle", { count: data.payments.length })}</h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted">{t("none")}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {data.payments.map((pm, i) => (
              <li key={i}>
                {t("paymentLine", {
                  purpose: t(`purpose.${pm.purpose}` as never),
                  amount: (pm.amountCents / 100).toLocaleString(il, { style: "currency", currency: pm.currency.toUpperCase() }),
                  date: day(pm.paidAt),
                  children: pm.children.join(", ") || "—",
                })}
                {pm.refundedCents > 0 ? ` · ${t("refunded")}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.children.map((k) => (
        <Card key={k.firstName + k.birthYear} data-testid="child-data">
          <h2 className="mb-2 text-lg font-semibold">{k.firstName}</h2>
          <dl>
            <Row label={t("displayName")} value={k.displayName} />
            <Row label={t("birthYear")} value={String(k.birthYear)} />
            <Row label={t("registered")} value={k.registered ? day(k.registeredAt) : t("no")} />
            <Row label={t("available")} value={pts(k.christmasMagic.availableCentipoints)} />
            <Row label={t("held")} value={pts(k.christmasMagic.heldForGiftsCentipoints)} />
          </dl>
          <h3 className="mb-1 mt-4 font-semibold">{t("wishList", { count: k.wishList.length })}</h3>
          <ul className="list-disc pl-5 text-sm">
            {k.wishList.map((g, i) => (
              <li key={i}>{t("giftLine", { gift: g.gift, status: t(`giftStatus.${g.status}` as never), funded: formatPoints(g.fundedCentipoints, il), cost: formatPoints(g.costCentipoints, il) })}</li>
            ))}
          </ul>
          <h3 className="mb-1 mt-4 font-semibold">{t("deeds", { count: k.goodDeeds.length })}</h3>
          <ul className="list-disc pl-5 text-sm">
            {k.goodDeeds.map((d, i) => (
              <li key={i}>
                {day(d.recordedAt)}: {d.ownWords || d.deed || t("aDeed")}
              </li>
            ))}
          </ul>
          <h3 className="mb-1 mt-4 font-semibold">{t("votes", { count: k.votes.length })}</h3>
          <p className="text-sm">{k.votes.map((v) => `${v.day} ${t(`vote.${v.vote}` as never)}`).join(" · ") || t("none")}</p>
          <p className="mt-4 text-sm text-muted">{t("historyNote", { count: k.magicHistory.length })}</p>
        </Card>
      ))}
      <p className="text-sm text-muted">
        {t("changeNote")}{" "}
        <Link href="/parent/delete-account" className="underline underline-offset-4">
          {t("deleteLink")}
        </Link>
      </p>
    </div>
  );
}

export default async function OurDataPage() {
  const t = await getTranslations("OurData");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-muted">{t("intro")}</p>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
