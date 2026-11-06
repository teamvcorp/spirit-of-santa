import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountMenu } from "@repo/auth/account-menu";
import { LocaleSwitcher } from "@repo/i18n/locale-switcher";
import { isLocale, LOCALES } from "@repo/lib/locales";
import { SiteHeader } from "@repo/ui/site-header";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Required with Cache Components: pre-render every language at build time. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
    // Internal tool: keep it out of search engines.
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound(); // the proxy normally guarantees a valid locale
  const common = await getTranslations("Common");

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Gives Client Components access to the locale and messages. */}
        <NextIntlClientProvider>
          <SiteHeader
            brand={<Link href="/">{common("brand")}</Link>}
            actions={
              <>
                <Link href="/stores" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.stores")}
                </Link>
                <Link href="/season" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.season")}
                </Link>
                <Link href="/users" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.users")}
                </Link>
                <Link href="/deeds" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.deeds")}
                </Link>
                <Link href="/moderation" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.moderation")}
                </Link>
                <Link href="/donations" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.donations")}
                </Link>
                <Link href="/settings" className="font-semibold underline-offset-4 hover:underline">
                  {common("nav.settings")}
                </Link>
                {/* usePathname() inside: on dynamic routes (e.g. /stores/[id]) the path isn't known
                    at prerender time, so it must stream in inside Suspense (Cache Components). */}
                <Suspense fallback={null}>
                  <LocaleSwitcher label={common("languageSwitcher")} />
                </Suspense>
                {/* Reads the session cookie (request-time), so it streams in after the
                    prerendered shell instead of making the whole page dynamic. */}
                <Suspense fallback={null}>
                  <AccountMenu authOptions={authOptions} />
                </Suspense>
              </>
            }
          />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
