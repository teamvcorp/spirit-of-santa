/**
 * Year-round calendar (owner 2026-11-07): the family site is open Jan 1 – Dec 25 and CLOSED Dec 26 – 31. It also
 * waits ("resetting") on Jan 1 until last season's reset has run. See docs/plans/year-round-season.md slice 2.
 *
 *  - <SeasonGate> goes INSIDE a page's <main> (after its back link) around the part that only makes sense while the
 *    season runs (kid pages, QR/donation links, /donate, pay-up, bonus, registration). While closed it shows a
 *    friendly "back January 1" card INSTEAD. Keeping <main> + back link outside lets PPR prerender that frame every
 *    day; only this part waits for the season read (review 2026-11-07).
 *  - <SeasonNotice> is a banner for pages that stay open (home, parent area): parents can still review, download or
 *    delete their family's data at any time (COPPA rights never close), sign in, and read the legal pages.
 *
 * Teaching note: this is only the friendly face. Every money/points service ALSO refuses on its own while closed
 * (giftWindow, donationWindow, startRegistration, wish-list engine, deeds, pay-up), so a hand-made request that
 * skips these pages still can't do anything. Never rely on hiding a page for security.
 *
 * Both read the season in a Suspense hole (Cache Components / PPR): the date and the reset record are per-request.
 */
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { familySiteClosed } from "@repo/stores/season";
import { Alert } from "@repo/ui/alert";
import { buttonClass } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";

export function SeasonGate({ children }: { children: ReactNode }) {
  return (
    // Reserve the space and tell screen readers something is loading (not an empty hole).
    <Suspense fallback={<div role="status" aria-busy="true" className="min-h-40" />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children }: { children: ReactNode }) {
  await connection();
  const closed = await familySiteClosed();
  // Not returned = never rendered: the gated page's own data loading doesn't run while closed.
  if (!closed) return children;
  const t = await getTranslations("SeasonClosed");
  return (
    <Card className="mx-auto w-full max-w-xl" data-testid="season-closed" data-reason={closed}>
        <h1 className="mb-2 text-2xl font-bold">{t(`${closed}.title`)}</h1>
        <p className="mb-4">{t(`${closed}.body`)}</p>
        <p className="mb-6 text-sm text-muted">{t("rights")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={buttonClass("primary")}>
            {t("home")}
          </Link>
          <Link href="/parent" className={buttonClass("secondary")}>
            {t("parentArea")}
          </Link>
        </div>
      </Card>
  );
}

export function SeasonNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}

async function Notice() {
  await connection();
  const closed = await familySiteClosed();
  if (!closed) return null;
  const t = await getTranslations("SeasonClosed");
  return (
    <div className="mb-4 w-full text-left" data-testid="season-notice" data-reason={closed}>
      <Alert>
        <strong>{t(`${closed}.title`)}</strong> {t(`${closed}.body`)}
      </Alert>
    </div>
  );
}
