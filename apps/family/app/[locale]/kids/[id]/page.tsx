/**
 * A kid's own page (opened from the kid selector; NO PIN: kids use it). Shows points and their
 * deeds; a usable deed shows its QR code to hold up for the person they helped.
 * Recording a NEW deed needs the parent PIN (/kids/[id]/deed).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { kidTally } from "@repo/families/votes";
import { localized } from "@repo/deeds/catalog";
import { listKidDeeds } from "@repo/deeds/deeds";
import { formatPoints } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Kid");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content({ params }: { params: PageProps<"/[locale]/kids/[id]">["params"] }) {
  await connection();
  const parent = await requireParent();
  const { id } = await params;
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const [kid, deeds, t, format, locale, tallies] = await Promise.all([getKid(parent, id), listKidDeeds(parent, id, origin), getTranslations("Kid"), getFormatter(), getLocale(), kidTally(parent, id)]);
  if (!kid || !deeds) notFound(); // other families' kids look the same as missing ones
  const day = (d?: Date) => (d ? format.dateTime(new Date(d), { month: "short", day: "numeric" }) : "");
  const title = (d: (typeof deeds)[number]) => d.custom || localized(d.title, locale) || t("aDeed");
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{kid.firstName}</h1>
          <p className="text-lg">{t("points", { points: formatPoints(kid.availableCentipoints) })}</p>
          {tallies && <p className="text-sm text-foreground/70" data-testid="kid-tally">{t("tally", { nice: tallies.nice, naughty: tallies.naughty, year: tallies.listYear })}</p>}
        </div>
        {kid.registered && (
          <Link href={`/kids/${kid.id}/deed`} className="rounded-lg bg-brand-red px-4 py-2 font-semibold text-white hover:bg-brand-red-dark">
            {t("record")}
          </Link>
        )}
      </div>
      {!kid.registered && <Alert className="mb-6">{t("notRegistered")}</Alert>}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("deedsTitle")}</h2>
        {deeds.length === 0 ? (
          <p className="text-foreground/70">{t("noDeeds")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10" data-testid="kid-deeds">
            {deeds.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{title(d)}</p>
                  <p className="text-sm text-foreground/70">
                    {day(d.createdAt)} · {t(`status.${d.status}` as never)}
                  </p>
                  {d.qr && <p className="mt-2 max-w-xs text-sm">{t("showQr", { until: day(d.expiresAt) })}</p>}
                </div>
                {d.qr && (
                  // eslint-disable-next-line @next/next/no-img-element -- a data: URL; next/image adds nothing
                  <img src={d.qr.image} alt={t("qrAlt", { deed: title(d) })} width={220} height={220} className="rounded-lg bg-white p-2" data-qr-url={d.qr.url} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default async function KidPage(props: PageProps<"/[locale]/kids/[id]">) {
  const t = await getTranslations("Kid");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Link href="/" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Suspense fallback={null}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}
