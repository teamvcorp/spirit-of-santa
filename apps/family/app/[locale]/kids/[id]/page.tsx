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
import { donationLink, qrImage } from "@repo/deeds/donate";
import { ResetLinkForm } from "./donation-card";
import { WishListCard } from "./wish-list-card";
import { NIGHT_SCOPE } from "@repo/ui/site-header";
import { Celebration } from "../../../../components/celebration";
import { kidWishList } from "@repo/wishlists/catalog";
import { formatPoints } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";
import { buttonClass } from "@repo/ui/button";
import { SeasonGate } from "@/components/season-gate";

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
  const [kid, deeds, t, format, locale, tallies, wishes] = await Promise.all([getKid(parent, id), listKidDeeds(parent, id, origin), getTranslations("Kid"), getFormatter(), getLocale(), kidTally(parent, id), kidWishList(parent, id)]);
  if (!kid || !deeds || !wishes) notFound(); // other families' kids look the same as missing ones
  const link = kid.registered ? await donationLink(parent, id, origin) : null;
  const donate = link ? { url: link, image: await qrImage(link) } : null;
  const day = (d?: Date) => (d ? format.dateTime(new Date(d), { month: "short", day: "numeric" }) : "");
  const notes = await getTranslations("Qr.notes");
  const gifts = await getTranslations("Gifts");
  const title = (d: (typeof deeds)[number]) => d.custom || localized(d.title, locale) || t("aDeed");
  return (
    <>
      {/* Night band (Phase 8.5): the child's name, their Christmas Magic and Santa's list. */}
      <div style={NIGHT_SCOPE} className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-[var(--t-band)] p-5 text-foreground shadow-card">
        <div className="flex flex-col gap-1">
          <h1 className="text-4xl font-bold">{kid.firstName}</h1>
          {tallies && <p className="text-sm text-muted" data-testid="kid-tally">{t("tally", { nice: tallies.nice, naughty: tallies.naughty, year: tallies.listYear })}</p>}
        </div>
        <p className="rounded-2xl bg-accent px-4 py-2 font-display text-xl font-bold text-on-accent">{t("points", { points: formatPoints(kid.availableCentipoints) })}</p>
        {kid.registered && (
          <Link href={`/kids/${kid.id}/deed`} className={buttonClass("festive", "w-full sm:w-auto")}>
            {t("record")}
          </Link>
        )}
      </div>
      {/* A surprise is never named here (its row is masked): "Your surprise gift is all yours". */}
      <Celebration funded={wishes.rows.filter((w) => ["fully_funded", "locked", "shipped", "delivered"].includes(w.status)).map((w) => ({ id: w.id, name: w.surprise ? gifts("surpriseName") : w.name }))} />
      {!kid.registered && <Alert className="mb-6">{t("notRegistered")}</Alert>}
      <WishListCard kidId={kid.id} registered={kid.registered} cap={kid.itemCap} list={wishes} />
      {donate && (
        <Card className="mb-6">
          <h2 className="mb-1 text-lg font-semibold">{t("donateTitle")}</h2>
          <p className="mb-3 text-sm text-muted">{t("donateIntro")}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL; next/image adds nothing */}
            <img src={donate.image} alt={t("donateQrAlt")} width={220} height={220} className="rounded-lg bg-white p-2" data-donate-url={donate.url} />
            <div className="flex flex-col gap-3">
              <p className="break-all text-sm">{donate.url}</p>
              <ResetLinkForm kidId={kid.id} />
            </div>
          </div>
        </Card>
      )}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("deedsTitle")}</h2>
        {deeds.length === 0 ? (
          <p className="text-muted">{t("noDeeds")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10" data-testid="kid-deeds">
            {deeds.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{title(d)}</p>
                  <p className="text-sm text-muted">
                    {day(d.createdAt)} · {t(`status.${d.status}` as never)}
                  </p>
                  {d.qr && <p className="mt-2 max-w-xs text-sm">{t("showQr", { until: day(d.expiresAt) })}</p>}
                  {/* Only notes the parent approved ever reach this page. */}
                  {d.note && (
                    <p className="mt-2 max-w-xs text-sm font-semibold" data-testid="deed-note">
                      {t("thankNote", { note: notes(d.note) })}
                    </p>
                  )}
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
      <SeasonGate>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
