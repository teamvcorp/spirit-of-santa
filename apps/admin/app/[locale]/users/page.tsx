/**
 * /users: find any account (email starts-with, role, status), newest first, 50 per page.
 * Kids are not accounts and never appear here (COPPA).
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { listUsers } from "@repo/auth/admin-users";
import { ROLES, type Role } from "@repo/lib/roles";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@repo/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Users");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const STATUSES = ["pending", "active", "suspended"] as const;
const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

async function Content({ searchParams }: { searchParams: PageProps<"/[locale]/users">["searchParams"] }) {
  await connection();
  await requireRole(authOptions, "admin");
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 254);
  const role = (ROLES as readonly string[]).includes(first(sp.role)) ? (first(sp.role) as Role) : undefined;
  const status = (STATUSES as readonly string[]).includes(first(sp.status)) ? (first(sp.status) as (typeof STATUSES)[number]) : undefined;
  const page = Number.parseInt(first(sp.page), 10) || 1;
  const [data, t, format] = await Promise.all([listUsers({ q, role, status, page }), getTranslations("Users"), getFormatter()]);
  const day = (d?: Date) => (d ? format.dateTime(new Date(d), { year: "numeric", month: "short", day: "numeric" }) : "—");
  const pageHref = (p: number) => ({ pathname: "/users" as const, query: { ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}), page: String(p) } });
  return (
    <>
      {/* Plain GET form: works before JavaScript, and the filters live in the URL (shareable). */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("searchLabel")}
          <input name="q" type="search" defaultValue={q} maxLength={254} placeholder={t("searchPlaceholder")} className="min-h-11 rounded-lg border border-input bg-background px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("roleLabel")}
          <select name="role" defaultValue={role ?? ""} className="min-h-11 rounded-lg border border-input bg-background px-3">
            <option value="">{t("any")}</option>
            {ROLES.filter((r) => r !== "child").map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("statusLabel")}
          <select name="status" defaultValue={status ?? ""} className="min-h-11 rounded-lg border border-input bg-background px-3">
            <option value="">{t("any")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass()}>
          {t("search")}
        </button>
      </form>
      <p className="mb-2 text-sm text-muted">{t("count", { total: data.total })}</p>
      {data.rows.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-foreground/15">
                <th className="py-2 pr-4">{t("colEmail")}</th>
                <th className="py-2 pr-4">{t("colRole")}</th>
                <th className="py-2 pr-4">{t("colStatus")}</th>
                <th className="py-2 pr-4">{t("colCreated")}</th>
                <th className="py-2">{t("colLastLogin")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((u) => (
                <tr key={u.id} className="border-b border-foreground/10">
                  <td className="py-2 pr-4">
                    <Link href={`/users/${u.id}`} className="font-semibold underline underline-offset-4">
                      {u.email}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {t(`roles.${u.role}`)}
                    {u.role === "admin" && <span className="ml-1 text-muted">({u.mfa ? t("mfaOn") : t("mfaOff")})</span>}
                  </td>
                  <td className="py-2 pr-4">{t(`statuses.${u.status}` as never)}</td>
                  <td className="py-2 pr-4">{day(u.createdAt)}</td>
                  <td className="py-2">{day(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.pages > 1 && (
        <nav aria-label={t("pagesLabel")} className="mt-4 flex gap-4 text-sm">
          {data.page > 1 && <Link href={pageHref(data.page - 1)} className="underline">{t("prev")}</Link>}
          <span>{t("pageOf", { page: data.page, pages: data.pages })}</span>
          {data.page < data.pages && <Link href={pageHref(data.page + 1)} className="underline">{t("next")}</Link>}
        </nav>
      )}
    </>
  );
}

export default async function UsersPage(props: PageProps<"/[locale]/users">) {
  const t = await getTranslations("Users");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-muted">{t("intro")}</p>
      <Suspense fallback={<p className="text-muted">{t("loading")}</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
