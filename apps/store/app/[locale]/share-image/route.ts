// Link-preview image (og:image / twitter:image), wired up in ../layout.tsx → openGraph.images.
// A plain route instead of Next's opengraph-image file convention because:
//  - the convention's address is always /en/... for English, which our URLs drop (as-needed prefix), so every
//    English preview would start with a redirect; this route lives at /share-image (+ /es/share-image);
//  - route handlers can't read the language from next/root-params yet, so it comes from the URL params here.
// Generic brand card (never anything about a child). Art + layout: @repo/ui/share-image.
import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@repo/lib/locales";
import { renderShareImage } from "@repo/ui/share-image";

/** Build both languages ahead of time: crawlers get a ready-made file, no rendering per request. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function GET(_req: Request, ctx: RouteContext<"/[locale]/share-image">) {
  const { locale: raw } = await ctx.params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return renderShareImage({ title: t("title"), tagline: t("description") });
}
