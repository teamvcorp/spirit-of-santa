import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listReps } from "@repo/stores/owner";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { DashboardNav } from "../dashboard-nav";
import { isStoreEditable, loadMember } from "../member";
import { NoAccess } from "../no-access";
import { InviteRepForm, RepsList } from "./reps-ui";

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
  const editable = isStoreEditable(store.status);
  return (
    <>
      <DashboardNav isOwner current="reps" />
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-muted">{t("intro")}</p>
      {!editable && <Alert className="mb-4">{t("readOnly")}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("current")}</h2>
          <RepsList reps={data.reps} />
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
          <p className="mb-4 text-sm text-muted">{t("inviteIntro")}</p>
          {/* Only admin-approved stores may send invites (anti spam-relay; review 2026-11-05). */}
          <InviteRepForm canInvite={store.status === "approved"} />
        </Card>
      </div>
    </>
  );
}

export default async function RepsPage() {
  const t = await getTranslations("Dashboard");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}