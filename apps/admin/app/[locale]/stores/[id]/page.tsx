import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { formatDiscount } from "@repo/lib/store";
import { getStoreDetail } from "@repo/stores/queries";
import { objectIdSchema } from "@repo/stores/schemas";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { StoreActions } from "./store-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("StoreAdmin");
  return { title: t("detailTitle") };
}

async function Detail({ params }: { params: PageProps<"/[locale]/stores/[id]">["params"] }) {
  await connection();
  await requireRole(authOptions, "admin");
  const { id } = await params;
  if (!objectIdSchema.safeParse(id).success) notFound();
  const store = await getStoreDetail(id);
  if (!store) notFound();
  const [t, statusT, cats, auditT, format] = await Promise.all([
    getTranslations("StoreAdmin"),
    getTranslations("Common.storeStatus"),
    getTranslations("Common.storeCategories"),
    getTranslations("StoreAdmin.audit"),
    getFormatter(),
  ]);
  const date = (iso?: string) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—");
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1">
      <dt className="text-foreground/70">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{store.name}</h1>
        <span className="rounded-full border border-foreground/20 px-3 py-1 text-sm">{statusT(store.status)}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("details")}</h2>
          <dl className="text-sm">
            {row(t("category"), cats(store.category as never))}
            {row(t("description"), store.description)}
            {row(t("address"), [store.address?.line1, store.address?.city, store.address?.state, store.address?.zip].filter(Boolean).join(", "))}
            {row(t("phone"), store.phone)}
            {row(t("website"), store.website)}
            {row(t("owner"), [store.ownerName, store.ownerEmail].filter(Boolean).join(" · "))}
            {row(t("ownerVerified"), store.ownerVerified ? t("yes") : t("no"))}
            {row(t("discount"), store.discountBps != null ? formatDiscount(store.discountBps) : t("notSet"))}
            {row(t("agreement"), store.agreement ? t("agreementAccepted", { version: store.agreement.version ?? "", date: date(store.agreement.acceptedAt) }) : t("agreementMissing"))}
            {row(t("items"), String(store.itemCount))}
            {row(t("reps"), String(store.repCount))}
            {row(t("registered"), date(store.createdAt))}
            {store.rejectionReason && row(t("rejectionReason"), store.rejectionReason)}
          </dl>
        </Card>
        <div className="flex flex-col gap-6">
          <StoreActions
            storeId={store.id}
            status={store.status}
            discountPercent={store.discountBps != null ? String(store.discountBps / 100) : undefined}
          />
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t("history")}</h2>
            {store.history.length === 0 ? (
              <p className="text-sm text-foreground/70">{t("noHistory")}</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {store.history.map((h, i) => (
                  <li key={i}>
                    <span className="font-medium">{auditT(h.action.replace(".", "_") as never)}</span> · {date(h.at)}
                    {h.actorEmail && <> · {h.actorEmail}</>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default async function StoreDetailPage({ params }: PageProps<"/[locale]/stores/[id]">) {
  const t = await getTranslations("StoreAdmin");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Link href="/stores" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("backToQueue")}
      </Link>
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}