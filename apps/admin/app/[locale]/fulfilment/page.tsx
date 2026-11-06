/**
 * /fulfilment (Phase 6 slice 3b): gifts on their way from stores to families. Admin only.
 *  1. Needs a substitute: funded when the store had none → agree a substitute with the store.
 *  2. In transit: the store shipped it → "Received" when the package arrives (match the ref code).
 *  3. To send: received → "Sent to family" (the parent is emailed "on its way").
 *  4. Sent to families (last 30 days), with whether the parent email went out.
 * Admins see who each received gift is for (they deliver it); stores never do.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { adminFulfilment, type AdminFulfilmentRow } from "@repo/wishlists/fulfilment";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { StepButton, SubstituteForm } from "./step-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Fulfilment");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  await connection();
  await requireRole(authOptions, "admin");
  const [f, t, format] = await Promise.all([adminFulfilment(), getTranslations("Fulfilment"), getFormatter()]);
  const day = (d: Date | null) => (d ? format.dateTime(new Date(d), { month: "short", day: "numeric" }) : "");
  const head = (r: AdminFulfilmentRow) => (
    <p>
      <span className="font-semibold">{r.itemName}</span> · <span className="font-mono">{r.ref}</span> · {t("from", { store: r.storeName })}
    </p>
  );
  const who = (r: AdminFulfilmentRow) => <p className="text-sm">{t("forWhom", { kid: r.kidName ?? "", family: r.familyName ?? "", email: r.parentEmail ?? "" })}</p>;
  const empty = <p className="text-foreground/70">{t("none")}</p>;
  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="substitutes">
        <h2 className="mb-1 text-lg font-semibold">{t("subTitle", { count: f.substitutes.length })}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("subIntro")}</p>
        {f.substitutes.length === 0
          ? empty
          : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {f.substitutes.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3" data-ref={r.ref}>
                  {head(r)}
                  <p className="text-sm text-foreground/70">{t("storeContact", { email: r.storeEmail })} · {t("fundedOn", { date: day(r.fullyFundedAt) })}</p>
                  <SubstituteForm wishId={r.id} refCode={r.ref} />
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card data-testid="in-transit">
        <h2 className="mb-1 text-lg font-semibold">{t("transitTitle", { count: f.inTransit.length })}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("transitIntro")}</p>
        {f.inTransit.length === 0
          ? empty
          : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {f.inTransit.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3" data-ref={r.ref}>
                  {head(r)}
                  <p className="text-sm text-foreground/70">
                    {t("shippedOn", { date: day(r.shippedAt) })}
                    {r.trackingNote ? ` · ${r.trackingNote}` : ""}
                  </p>
                  <StepButton wishId={r.id} kind="received" />
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card data-testid="to-send">
        <h2 className="mb-1 text-lg font-semibold">{t("sendTitle", { count: f.toSend.length })}</h2>
        <p className="mb-3 text-sm text-foreground/70">{t("sendIntro")}</p>
        {f.toSend.length === 0
          ? empty
          : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {f.toSend.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3" data-ref={r.ref}>
                  {head(r)}
                  {who(r)}
                  <p className="text-sm text-foreground/70">{t("receivedOn", { date: day(r.receivedAt) })}</p>
                  <StepButton wishId={r.id} kind="sent" />
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card data-testid="delivered">
        <h2 className="mb-3 text-lg font-semibold">{t("deliveredTitle")}</h2>
        {f.delivered.length === 0
          ? empty
          : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {f.delivered.map((r) => (
                <li key={r.id} className="py-3" data-ref={r.ref}>
                  {head(r)}
                  {who(r)}
                  <p className="text-sm text-foreground/70">
                    {t("sentOn", { date: day(r.deliveredAt) })} · {t(r.familyNotified ? "emailed" : "emailPending")}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

export default async function FulfilmentPage() {
  const t = await getTranslations("Fulfilment");
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}
