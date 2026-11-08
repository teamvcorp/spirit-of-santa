/**
 * Family home, rebuilt from the approved "Winter Magic / Festive" mockup (owner 2026-11-08; plan:
 * docs/plans/family-themes.md). UI and copy only: every link goes to a page that already existed.
 *
 *   hero (night sky or festive red, snow, the cottage scene) → [signed-in parent: kid selector] → How it works →
 *   countdown band (season dates) → For families / For Secret Santas.
 *
 * The page shell is prerendered per language. Everything that depends on the request (who's signed in, today's date,
 * the admin's season dates, receipts settings) streams in small Suspense holes (Cache Components / PPR).
 * Colours come from the theme variables (app/themes.css), so the switch in the header recolours it instantly.
 * Only this page has falling snow (owner's rule).
 */
import type { CSSProperties, ReactNode } from "react";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { listKids } from "@repo/families/kids";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents, formatLongDate, formatPoints } from "@repo/lib/format";
import { REGISTRATION_FEE_CENTS } from "@repo/lib/limits";
import { intlLocale } from "@repo/lib/locales";
import { getPlatformSettings } from "@repo/payments/settings";
import { NIGHT_SCOPE } from "@repo/ui/site-header";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { homeCountdown } from "@/lib/countdown";
import { HeroScene, Snow, Stars } from "../../components/hero-scene";
import { SeasonNotice } from "@/components/season-gate";

/* ---------- small building blocks ---------- */

/** Any dark band (hero, countdown, Secret Santa card): re-scope the role colours to the night set (focus ring gold). */
const band = (background: string): CSSProperties => ({ ...NIGHT_SCOPE, background });

const pillButton = "sos-lift inline-flex min-h-[52px] items-center gap-2.5 rounded-full px-7 text-[1.05rem] font-extrabold no-underline";

function HouseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function GiftIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="13" rx="1.5" />
      <path d="M12 8v13M3 12h18M12 8c-1.5-3-5-3.5-5-1.2C7 8 12 8 12 8zM12 8c1.5-3 5-3.5 5-1.2C17 8 12 8 12 8z" />
    </svg>
  );
}

/* ---------- request-time pieces (each in its own Suspense hole) ---------- */

/** "N nights until Christmas" (only while the season is open or frozen). */
async function NightsPill() {
  await connection();
  const [c, t] = await Promise.all([homeCountdown(), getTranslations("HomePage")]);
  if (c.phase === "off") return null;
  return (
    <p
      className="mb-5 inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-[.95rem] font-extrabold tracking-wide"
      style={{ background: "var(--t-pill-bg)", borderColor: "var(--t-pill-border)", color: "var(--t-gold)" }}
      data-testid="nights-pill"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
      {t("nightsToChristmas", { count: c.nights })}
    </p>
  );
}

/** Hero buttons. Signed out: create an account + Secret Santa. Signed-in parent: Secret Santa only (kids come next). */
async function HeroButtons() {
  await connection();
  const [user, t] = await Promise.all([getSessionUser(authOptions), getTranslations("HomePage")]);
  return (
    <div className="mt-8 flex flex-wrap justify-center gap-3.5">
      {user?.role !== "parent" && (
        <Link href="/register" className={pillButton} style={{ background: "var(--t-cta-bg)", color: "var(--t-cta-ink)", boxShadow: "var(--t-cta-shadow)" }}>
          <HouseIcon />
          {t("signUp")}
        </Link>
      )}
      <Link href="/donate" className={`${pillButton} border-2`} style={{ borderColor: "var(--t-cta2)", color: "var(--t-cta2)" }}>
        <GiftIcon />
        {t("ctaSanta")}
      </Link>
    </div>
  );
}

/** Signed-in parent: the KID SELECTOR (unchanged behaviour: the default view on the family's device). */
async function KidSelector() {
  await connection();
  const user = await getSessionUser(authOptions);
  if (user?.role !== "parent") return null;
  const [kids, t] = await Promise.all([listKids({ id: user.id, familyId: user.familyId }), getTranslations("HomePage")]);
  return (
    <section className="px-6 pt-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h2 className="text-2xl font-bold">{t("whoIsHere")}</h2>
        {kids.length === 0 ? (
          <p className="text-muted">{t("noKidsYet")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="kid-selector">
            {kids.map((k) => (
              <li key={k.id}>
                <Link
                  href={`/kids/${k.id}`}
                  className="flex h-full flex-col gap-2 rounded-3xl border border-(--t-card-border) bg-surface p-4 no-underline shadow-card transition hover:border-accent focus-visible:border-accent"
                >
                  <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-accent font-display text-2xl font-bold text-on-accent">
                    {k.firstName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-lg font-extrabold">{k.firstName}</span>
                  <span className="text-sm font-bold text-accent-text">{t("points", { points: formatPoints(k.availableCentipoints) })}</span>
                  {!k.registered && <span className="self-start rounded-full border border-foreground/25 px-2 text-xs">{t("awaiting")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/parent" className="self-start text-sm underline underline-offset-4">
          {t("parentArea")}
        </Link>
      </div>
    </section>
  );
}

function Tile({ value, label, note, gold }: { value: string; label: string; note: string; gold?: boolean }) {
  return (
    <div
      className="rounded-[22px] border px-5 py-7 text-center"
      style={gold ? { background: "rgb(246 210 122 / 0.1)", borderColor: "rgb(246 210 122 / 0.4)" } : { background: "rgb(255 248 231 / 0.07)", borderColor: "rgb(255 248 231 / 0.2)" }}
    >
      <p className={`m-0 font-display font-bold leading-none ${gold ? "text-[3.6rem]" : "text-[2.4rem] leading-[1.5]"}`} style={{ color: gold ? "var(--t-gold)" : "var(--t-cream)" }}>
        {value}
      </p>
      <p className="mt-2.5 font-bold" style={{ color: "var(--t-cream)" }}>{label}</p>
      <p className="mt-1 text-[.9rem]" style={{ color: "var(--t-band-sub)" }}>{note}</p>
    </div>
  );
}

/** Countdown band (owner: countdown only for now, no live numbers). Hidden while the site is closed. */
async function CountdownBand() {
  await connection();
  const [c, t, locale] = await Promise.all([homeCountdown(), getTranslations("HomePage"), getLocale()]);
  if (c.phase === "off") return null;
  const day = (d: Date) => formatLongDate(d, locale);
  return (
    <section className="relative overflow-hidden px-6 py-20" style={band("var(--t-band)")} data-testid="countdown-band">
      <Snow layers={["far"]} />
      <div className="relative mx-auto grid max-w-[1120px] gap-5 sm:grid-cols-2">
        {c.phase === "open" ? (
          <Tile gold value={String(c.shareDays)} label={t("bandShareLabel", { count: c.shareDays })} note={day(c.freeze)} />
        ) : (
          <Tile gold value={String(c.nights)} label={t("bandNightsLabel", { count: c.nights })} note={t("bandSharedNote")} />
        )}
        <Tile value={day(c.shipBy)} label={t("bandShipLabel")} note={t("bandShipNote")} />
      </div>
    </section>
  );
}

/** "For families" button: sign up, or the parent area for a signed-in parent. */
async function FamiliesButton() {
  await connection();
  const [user, t] = await Promise.all([getSessionUser(authOptions), getTranslations("HomePage")]);
  const parent = user?.role === "parent";
  return (
    <Link href={parent ? "/parent" : "/register"} className="sos-lift mt-2 inline-flex min-h-[50px] items-center self-start rounded-full bg-[#c8102e] px-6 font-extrabold text-white no-underline">
      {parent ? t("familiesParentCta") : t("signUp")}
    </Link>
  );
}

/** Secret Santa card text: the share-out day while giving is open; the charity line once admin Settings has it. */
async function SantaDetails() {
  await connection();
  const [c, settings, t, community, locale] = await Promise.all([
    homeCountdown(),
    getPlatformSettings(),
    getTranslations("HomePage"),
    getTranslations("Community"),
    getLocale(),
  ]);
  return (
    <>
      <p className="m-0 leading-relaxed" style={{ color: "var(--t-santa-sub)" }}>
        {c.phase === "open" ? t("santaBody", { day: formatLongDate(c.freeze, locale) }) : t("santaBodyLater")}
      </p>
      <Link href="/donate" className="sos-lift mt-2 inline-flex min-h-[50px] items-center self-start rounded-full px-6 font-extrabold no-underline" style={{ background: "var(--t-gold)", color: "#1b2a4a" }}>
        {t("ctaSanta")}
      </Link>
      {/* Same rule as /donate: the charity name + EIN only once they're entered in admin Settings. */}
      {settings.receiptsReady && (
        <p className="mt-1.5 text-[.85rem]" style={{ color: "var(--t-santa-sub)" }}>
          {community("charity", { orgName: settings.charity.legalName, ein: settings.charity.ein })}
        </p>
      )}
    </>
  );
}

/* ---------- the page ---------- */

function StepCard({ n, icon, iconBg, iconInk, title, body }: { n: number; icon: ReactNode; iconBg: string; iconInk: string; title: string; body: string }) {
  return (
    <article className="rounded-[22px] border border-(--t-card-border) bg-surface px-7 py-8 shadow-card" style={{ borderTop: "var(--t-card-top)" }}>
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-2xl" style={{ background: iconBg, color: iconInk }}>
          {icon}
        </span>
        <span aria-hidden="true" className="font-display text-[2.4rem] font-bold text-[#e9d6a6]">
          {n}
        </span>
      </div>
      <h3 className="mt-[18px] mb-2 text-[1.45rem] font-bold">{title}</h3>
      <p className="m-0 leading-relaxed text-muted">{body}</p>
    </article>
  );
}

export default async function Home() {
  const [t, locale] = await Promise.all([getTranslations("HomePage"), getLocale()]);
  const rate = formatCents(CENTS_PER_POINT, intlLocale(locale));
  const fee = formatCents(REGISTRATION_FEE_CENTS, intlLocale(locale));
  return (
    <main className="flex flex-1 flex-col">
      {/* HERO: night sky (Winter Magic) or Christmas red (Festive). */}
      <section className="relative overflow-hidden" style={band("var(--t-hero)")}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "var(--t-aurora)" }} />
        <Stars />
        <Snow layers={["far", "mid"]} />
        <div className="relative z-[3] mx-auto max-w-[860px] px-6 pt-14 pb-16 text-center sm:pb-0">
          <Suspense fallback={null}>
            <NightsPill />
          </Suspense>
          <h1 className="m-0 text-[clamp(2.6rem,6vw,4.6rem)] font-bold leading-[1.05] tracking-[-0.5px] [text-shadow:0_2px_24px_rgb(0_0_0/0.35)]" style={{ color: "var(--t-cream)" }}>
            {t.rich("heroTitle", { gold: (chunks) => <span style={{ color: "var(--t-gold)" }}>{chunks}</span> })}
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-[clamp(1.05rem,2vw,1.25rem)] leading-relaxed" style={{ color: "var(--t-hero-sub)" }}>
            {t("heroIntro")}
          </p>
          <Suspense fallback={<div className="mt-8 min-h-[52px]" />}>
            <HeroButtons />
          </Suspense>
        </div>
        {/* The cottage scene is hidden on phones (owner 2026-11-08: too small to enjoy there); the hero ends after
            the buttons instead. From 640px wide (Tailwind sm) it shows. */}
        <div className="relative z-[2] mx-auto mt-6 hidden max-w-[1200px] sm:block">
          <HeroScene />
        </div>
        <Snow layers={["near"]} />
      </section>

      <div className="px-6 pt-6 empty:hidden">
        <SeasonNotice />
      </div>

      <Suspense fallback={null}>
        <KidSelector />
      </Suspense>

      {/* HOW IT WORKS (cream in both themes). "/#how" in the header jumps here. */}
      <section id="how" className="scroll-mt-4 px-6 py-[88px]">
        <div className="mx-auto max-w-[1120px]">
          <p className="m-0 text-center text-[.85rem] font-extrabold uppercase tracking-[2px]" style={{ color: "var(--t-eyebrow)" }}>
            {t("howEyebrow")}
          </p>
          <h2 className="mt-2.5 mb-12 text-center text-[clamp(2rem,4vw,2.9rem)] font-bold leading-tight">{t("howTitle")}</h2>
          <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            <StepCard
              n={1}
              iconBg="#FDE8EA"
              iconInk="#C8102E"
              title={t("step1Title")}
              body={t("step1Body")}
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
                </svg>
              }
            />
            <StepCard
              n={2}
              iconBg="#FFF1CC"
              iconInk="#9A6A00"
              title={t("step2Title")}
              body={t("step2Body", { rate })}
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7l1.5 3.2 3.5.4-2.6 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.5L7 10.6l3.5-.4z" />
                </svg>
              }
            />
            <StepCard n={3} iconBg="#DFF2EA" iconInk="#1F5C46" title={t("step3Title")} body={t("step3Body")} icon={<GiftIcon size={28} />} />
          </div>
        </div>
      </section>

      <Suspense fallback={null}>
        <CountdownBand />
      </Suspense>

      {/* TWO PATHS */}
      <section className="px-6 py-[88px]">
        <div className="mx-auto grid max-w-[1120px] gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          <article className="flex flex-col gap-3.5 rounded-[26px] border border-(--t-card-border) bg-surface px-9 py-10 shadow-card">
            <p className="m-0 text-[.8rem] font-extrabold uppercase tracking-[2px]" style={{ color: "var(--t-eyebrow)" }}>
              {t("familiesEyebrow")}
            </p>
            <h2 className="m-0 text-[2rem] font-bold leading-tight">{t("familiesTitle")}</h2>
            <p className="m-0 leading-relaxed text-muted">{t("familiesBody", { fee })}</p>
            <Suspense fallback={<div className="min-h-[50px]" />}>
              <FamiliesButton />
            </Suspense>
          </article>
          <article className="relative flex flex-col gap-3.5 overflow-hidden rounded-[26px] px-9 py-10" style={{ ...band("var(--t-santa-card)"), color: "var(--t-cream)" }}>
            <svg aria-hidden="true" width="160" height="160" viewBox="0 0 24 24" fill="none" strokeWidth=".6" className="absolute -top-6 -right-6 opacity-25" style={{ stroke: "var(--t-gold)" }}>
              <path d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 8.8l6.1-.7z" />
            </svg>
            <p className="m-0 text-[.8rem] font-extrabold uppercase tracking-[2px]" style={{ color: "var(--t-gold)" }}>
              {t("santaEyebrow")}
            </p>
            <h2 className="m-0 text-[2rem] font-bold leading-tight">{t("santaTitle")}</h2>
            <Suspense fallback={<div className="min-h-[50px]" />}>
              <SantaDetails />
            </Suspense>
          </article>
        </div>
      </section>
    </main>
  );
}
