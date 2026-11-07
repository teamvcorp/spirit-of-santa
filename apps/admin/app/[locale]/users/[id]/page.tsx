/**
 * /users/[id]: one account: details, lockout, MFA, store, audit history, and the admin actions
 * that fit its current state (server re-checks them all).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { getUserDetail } from "@repo/auth/admin-users";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { UserActions } from "../user-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Users");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

async function Content({ params }: { params: PageProps<"/[locale]/users/[id]">["params"] }) {
  await connection();
  const admin = await requireRole(authOptions, "admin");
  const { id } = await params;
  const [u, t, format, at] = await Promise.all([getUserDetail(id), getTranslations("Users"), getFormatter(), getTranslations("AuditActions")]);
  const label = (action: string) => (at.has(action.replace(/\./g, "_") as never) ? at(action.replace(/\./g, "_") as never) : action);
  if (!u) notFound();
  const when = (d?: Date) => (d ? format.dateTime(new Date(d), { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const self = u.id === admin.id;
  const ops = {
    suspend: !self && u.status === "active",
    reinstate: u.status === "suspended" && u.suspendedByAdmin,
    unlock: Boolean(u.lockedUntil),
    signOut: !self && u.status === "active",
    resetMfa: !self && u.role === "admin" && Boolean(u.mfa),
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold break-all">{u.email}</h1>
        <span className="rounded-full border border-foreground/20 px-3 py-1 text-sm">{t(`statuses.${u.status}` as never)}</span>
      </div>
      {self && <Alert>{t("selfNote")}</Alert>}
      {u.status === "suspended" && !u.suspendedByAdmin && <Alert>{t("errors.removedRep")}</Alert>}
      {u.lockedUntil && <Alert tone="error">{t("lockedUntil", { when: when(u.lockedUntil) })}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("details")}</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t("colRole")}</dt>
            <dd>{t(`roles.${u.role}`)}</dd>
            {u.name && (
              <>
                <dt className="text-muted">{t("name")}</dt>
                <dd>{u.name}</dd>
              </>
            )}
            <dt className="text-muted">{t("colCreated")}</dt>
            <dd>{when(u.createdAt)}</dd>
            <dt className="text-muted">{t("colLastLogin")}</dt>
            <dd>{when(u.lastLoginAt)}</dd>
            {u.store && (
              <>
                <dt className="text-muted">{t("store")}</dt>
                <dd>
                  <Link href={`/stores/${u.store.id}`} className="underline underline-offset-4">
                    {u.store.name}
                  </Link>
                </dd>
              </>
            )}
            {u.role === "admin" && (
              <>
                <dt className="text-muted">{t("mfa")}</dt>
                <dd>{u.mfa ? t("mfaSince", { when: when(u.mfa.since), left: u.mfa.recoveryCodesLeft }) : t("mfaNotSetUp")}</dd>
              </>
            )}
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("actionsTitle")}</h2>
          {Object.values(ops).some(Boolean) ? <UserActions userId={u.id} ops={ops} email={u.email} /> : <p className="text-sm text-muted">{t("noActions")}</p>}
        </Card>
      </div>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("history")}</h2>
        {u.history.length === 0 ? (
          <p className="text-sm text-muted">{t("noHistory")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {u.history.map((h, i) => (
              <li key={i}>
                <span className="text-muted">{when(h.at)}</span> · {label(h.action)}
                {h.byThisUser ? ` (${t("byThisUser")})` : ""}
                {typeof h.details?.reason === "string" ? ` · ${h.details.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default async function UserPage(props: PageProps<"/[locale]/users/[id]">) {
  const t = await getTranslations("Users");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <Link href="/users" className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("back")}
      </Link>
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}
