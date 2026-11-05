import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listReps } from "@repo/stores/owner";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { DashboardNav } from "../dashboard-nav";
import { EDITABLE_STATUSES, loadMember } from "../member";
import { NoAccess } from "../no-access";
import { InviteRepForm, RemoveRepButton } from "./reps-ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Reps");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function Content() {
  const { user, store, isOwner } = await loadMember();
  if (!store || !isOwner) return <NoAccess />;
  const data = await listReps({ id: user.id, role: user.role, storeId: user.storeId });
  if (!data) return <NoAccess />;
  const [t, format] = await Promise.all([getTranslations("Reps"), getFormatter()]);
  const editable = EDITABLE_STATUSES.includes(store.status);
  return (
    <>
      <DashboardNav isOwner current="reps" />
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-foreground/70">{t("intro")}</p>
      {!editable && <Alert className="mb-4">{t("readOnly")}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("current")}</h2>
          {data.reps.length === 0 ? (
            <p className="text-sm text-foreground/70">{t("none")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {data.reps.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{r.name ?? r.email}</span>
                    {r.name && <span className="block text-sm text-foreground/70">{r.email}</span>}
                  </span>
                  <RemoveRepButton repId={r.id} name={r.name ?? r.email} />
                </li>
              ))}
            </ul>
          )}
          {data.invites.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold">{t("pending")}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {data.invites.map((i) => (
                  <li key={i.email}>
                    {i.email} · {t("expires", { date: format.dateTime(new Date(i.expiresAt), { dateStyle: "medium" }) })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("inviteTitle")}</h2>
          <p className="mb-4 text-sm text-foreground/70">{t("inviteIntro")}</p>
          <InviteRepForm editable={editable} />
        </Card>
      </div>
    </>
  );
}

export default async function RepsPage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-foreground/70">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}