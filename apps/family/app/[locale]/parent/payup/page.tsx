/**
 * /parent/payup (Phase 6 slice 4): during the pay-up window (freeze date → 7 days before the
 * close) a parent can pay the missing amount of each unfinished gift. Needs the PIN unlock.
 * Gifts still unfinished at the close drop off and their points go to Spirit O Santa.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents, formatPoints } from "@repo/lib/format";
import { payUpOptions } from "@repo/wishlists/payup";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { PayUpForm } from "./payup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PayUp");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  const parent = await requireUnlockedPage("/parent/payup");
  const [{ window, options }, t, format] = await Promise.all([payUpOptions(parent), getTranslations("PayUp"), getFormatter()]);
  const day = (d: Date) => format.dateTime(d, { month: "long", day: "numeric" });
  if (!window.open) return <Alert>{t("closed", { opens: day(window.opensAt), closes: day(window.lastPayDay) })}</Alert>;
  return (
    <>
      <Alert className="mb-4">{t("deadline", { closes: day(window.lastPayDay), close: day(window.closeAt) })}</Alert>
      {options.length === 0 ? (
        <p className="text-foreground/70">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-foreground/10" data-testid="payup-list">
          {options.map((o) => (
            <li key={o.wishId} className="flex flex-col gap-2 py-4" data-wish={o.wishId}>
              <p>
                <span className="font-semibold">{o.itemName}</span> · {o.kidName}
              </p>
              <p className="text-sm text-foreground/70">{t("missing", { points: formatPoints(o.missingCentipoints), amount: formatCents(o.cents) })}</p>
              <PayUpForm wishId={o.wishId} cents={o.cents} label={t("buttonFor", { item: o.itemName, kid: o.kidName })} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default async function PayUpPage() {
  const t = await getTranslations("PayUp");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <Link href="/parent" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Card>
        <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
        {/* Rate from the server constant (never hard-coded). */}
        <p className="mb-6 text-foreground/70">{t("intro", { rate: formatCents(CENTS_PER_POINT) })}</p>
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </Card>
    </main>
  );
}
