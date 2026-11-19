/**
 * /partners: "Our stores", every company we invited, from the SAME Store records as the store app
 * (@repo/stores/partners; owner 2026-11-18). Each tile: the store's own logo (or its name), a status badge
 * (Pending / Processing / Approved, or a grumpy face for a company that declined), and a North Star for a
 * Christmas Magic donor. Tapping a tile (not declined) opens /partners/<slug>, which sends the visitor on.
 * The star never changes the order (hard rule); the list order comes from listPartners only.
 */
import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { localizePath } from "@repo/i18n/paths";
import { isLocale } from "@repo/lib/locales";
import { listPartners, type Partner } from "@repo/stores/partners";
import { storeAppOrigin } from "@repo/stores/urls";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { SeasonGate } from "@/components/season-gate";
import { GrumpyFace, NorthStar } from "@/components/partner-icons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Partners");
  return { title: t("title"), description: t("intro") };
}

const BADGE: Record<Partner["status"], string> = {
  approved: "bg-primary text-on-primary",
  processing: "border border-accent text-foreground",
  pending: "border border-foreground/30 text-muted",
  declined: "border border-foreground/30 text-muted",
};

async function Tile({ p }: { p: Partner }) {
  const t = await getTranslations("Partners");
  const body = (
    <>
      {/* Logos sit on white (most logos are made for a light background), shown whole, never cropped. */}
      <div className="relative flex aspect-[3/2] items-center justify-center rounded-xl bg-snow p-4">
        {p.logoUrl ? (
          <Image src={p.logoUrl} alt="" width={240} height={160} className="max-h-full w-auto object-contain" />
        ) : (
          // No logo yet: the name IS the tile (shown once, not again below).
          <span className="text-center font-heading text-lg font-bold break-words text-night sm:text-xl">{p.name}</span>
        )}
        {p.donor && (
          <span className="absolute top-2 right-2" title={t("donor")} data-testid="partner-donor">
            <NorthStar className="size-7" />
            <span className="sr-only">{t("donor")}</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {p.logoUrl && <span className="min-w-0 font-semibold break-words">{p.name}</span>}
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[p.status]}`} data-testid="partner-status">
          {p.status === "declined" && <GrumpyFace className="size-4" />}
          {t(`status.${p.status}`)}
        </span>
      </div>
    </>
  );
  return (
    <li data-testid="partner" data-slug={p.slug} data-status={p.status}>
      {p.status === "declined" ? (
        <div className="flex h-full flex-col gap-2 rounded-2xl bg-surface p-3 shadow-card">{body}</div>
      ) : (
        <Link href={`/partners/${p.slug}`} className="sos-lift flex h-full flex-col gap-2 rounded-2xl bg-surface p-3 text-foreground no-underline shadow-card">
          {body}
        </Link>
      )}
    </li>
  );
}

async function Content() {
  await connection(); // live list (statuses and logos change any time)
  const [partners, t] = await Promise.all([listPartners(), getTranslations("Partners")]);
  if (partners.length === 0) return <Card><p>{t("empty")}</p></Card>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] sm:gap-4">
      {partners.map((p) => (
        <Tile key={p.slug} p={p} />
      ))}
    </ul>
  );
}

/**
 * "Own a store? Join" (owner 2026-11-19): stores already self-enroll at the store app's /register (pending until an
 * admin approves). A plain <a>: it is ANOTHER app, not a locale route here. No store-app address configured → no
 * line (never a broken page or link).
 */
async function JoinLine() {
  const [t, locale] = await Promise.all([getTranslations("Partners"), getLocale()]);
  let href: string;
  try {
    href = new URL(localizePath("/register", isLocale(locale) ? locale : "en"), storeAppOrigin()).toString();
  } catch {
    return null;
  }
  return (
    <p className="mt-8 text-center">
      {t("joinPrompt")}{" "}
      <a href={href} className="font-semibold underline underline-offset-4" data-testid="partners-join">
        {t("joinLink")}
      </a>
    </p>
  );
}

export default async function PartnersPage() {
  const t = await getTranslations("Partners");
  return (
    <main className="relative mx-auto w-full max-w-5xl flex-1 p-6">
      <SeasonGate>
        <h1 className="mb-2 text-3xl font-bold">{t("title")}</h1>
        <p className="mb-3 text-muted">{t("intro")}</p>
        {/* The badges, in words (so the little pictures are never the only explanation). */}
        <ul className="mb-6 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <li>{t("legend.approved")}</li>
          <li>{t("legend.processing")}</li>
          <li>{t("legend.pending")}</li>
          <li className="inline-flex items-center gap-1"><GrumpyFace className="size-4" /> {t("legend.declined")}</li>
          <li className="inline-flex items-center gap-1"><NorthStar className="size-4" /> {t("legend.donor")}</li>
        </ul>
        <Suspense fallback={null}>
          <Content />
        </Suspense>
        <Suspense fallback={null}>
          <JoinLine />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
