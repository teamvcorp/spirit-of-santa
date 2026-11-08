import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountMenu } from "@repo/auth/account-menu";
import { LocaleSwitcher } from "@repo/i18n/locale-switcher";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@repo/lib/locales";
import { metadataOrigin } from "@repo/lib/site";
import { fontVariables } from "@repo/ui/fonts";
import { Logo } from "@repo/ui/logo";
import { SHARE_IMAGE_SIZE } from "@repo/ui/share-image-size";
import { NIGHT_SCOPE, SiteHeader } from "@repo/ui/site-header";
import { authOptions } from "@/auth";
import { getPathname, Link } from "@/i18n/navigation";
import { FamilyTabs } from "../../components/family-tabs";
import { ThemeSwitch } from "../../components/theme-switch";
import { DEFAULT_THEME, THEME_SCRIPT } from "@/lib/theme";
import "../globals.css";

/** Required with Cache Components: pre-render every language at build time. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  const raw = await rootLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE; // the proxy guarantees a valid one; this narrows the type
  return {
    // Absolute base for the link-preview image URL (social sites can't follow a relative path).
    metadataBase: metadataOrigin("FAMILY_APP_URL", 3000),
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
    // Link previews (twitter:* copies these). Picture: ./share-image/route.ts, at /share-image or /es/share-image.
    openGraph: {
      type: "website",
      siteName: t("title"),
      title: t("title"),
      description: t("description"),
      locale: locale === "es" ? "es_US" : "en_US",
      images: [{ url: getPathname({ href: "/share-image", locale }), ...SHARE_IMAGE_SIZE, alt: t("title") }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound(); // the proxy normally guarantees a valid locale
  const common = await getTranslations("Common");
  const community = await getTranslations("Community");
  const footer = await getTranslations("Footer");
  const nav = await getTranslations("SiteNav");

  return (
    // data-theme: Winter Magic / Festive (app/themes.css). The server always sends the default (pages stay
    // prerendered); the <head> script swaps in the visitor's saved choice BEFORE the first paint, so React must
    // accept that one attribute differing (suppressHydrationWarning only covers this element's own attributes).
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${fontVariables} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Gives Client Components access to the locale and messages. */}
        <NextIntlClientProvider>
          <SiteHeader
            brand={<Link href="/" className="no-underline"><Logo label={common("brand")} /></Link>}
            actions={
              <>
                <Link href="/#how" className="font-semibold underline-offset-4 hover:underline">
                  {nav("howLink")}
                </Link>
                {/* Public page for community / corporate gifts (Phase 5 slice 2). */}
                <Link href="/donate" className="font-semibold underline-offset-4 hover:underline">
                  {community("navLink")}
                </Link>
                {/* usePathname() inside: on dynamic routes (e.g. /stores/[id]) the path isn't known
                    at prerender time, so it must stream in inside Suspense (Cache Components). */}
                <ThemeSwitch label={nav("themeLabel")} winter={nav("themeWinter")} festive={nav("themeFestive")} />
                <Suspense fallback={null}>
                  <LocaleSwitcher label={common("languageSwitcher")} variant="pill" />
                </Suspense>
                {/* Reads the session cookie (request-time), so it streams in after the
                    prerendered shell instead of making the whole page dynamic. */}
                <Suspense fallback={null}>
                  <AccountMenu authOptions={authOptions} />
                </Suspense>
              </>
            }
          />
          {/* Candy-cane stripe: shows only in Festive (0px tall in Winter Magic). */}
          <div aria-hidden="true" className="sos-stripe" />
          {children}
          <div aria-hidden="true" className="sos-stripe mt-auto" />
          {/* Night/evergreen footer (themes); NIGHT_SCOPE keeps the focus ring and text readable on it. */}
          <footer style={NIGHT_SCOPE} className="bg-[var(--t-footer)] px-6 py-10 text-center text-[.95rem] text-[var(--t-footer-ink)]">
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <li>
                <Link href="/privacy" className="text-[var(--t-cream)] underline underline-offset-4">
                  {footer("privacy")}
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-[var(--t-cream)] underline underline-offset-4">
                  {footer("terms")}
                </Link>
              </li>
              <li>
                <Link href="/text-messages" className="text-[var(--t-cream)] underline underline-offset-4">
                  {footer("texts")}
                </Link>
              </li>
            </ul>
            <p className="mt-4">{footer("tagline")}</p>
          </footer>
          {/* Bottom tab bar: signed-in family only (reads the session, so inside Suspense). */}
          <Suspense fallback={null}>
            <FamilyTabs />
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
