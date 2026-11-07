/**
 * Admin home = platform dashboard (Phase 3 slice 5). Signed-out visitors see only the intro.
 * Stat tiles follow the dataviz guide: label + value, no decoration; links lead to the list.
 */
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { dashboardStats } from "@/lib/dashboard";

type Tile = { label: string; value: number; href?: Parameters<typeof Link>[0]["href"] };

async function Tiles({ title, tiles }: { title: string; tiles: Tile[] }) {
  const format = await getFormatter();
  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-foreground/15 p-3">
            <dt className="text-sm text-muted">{tile.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {tile.href ? (
                <Link href={tile.href} className="underline underline-offset-4">
                  {format.number(tile.value)}
                </Link>
              ) : (
                format.number(tile.value)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

async function Dashboard() {
  await connection();
  const user = await getSessionUser(authOptions, { includeRestricted: true }); // redirected below
  if (user?.role !== "admin") return null;
  if (user.mfaSetup) redirect("/mfa/setup"); // no admin data until MFA is set up
  const [s, t, home, format, at] = await Promise.all([dashboardStats(), getTranslations("Dashboard"), getTranslations("HomePage"), getFormatter(), getTranslations("AuditActions")]);
  // "store.approve" -> "Store approved"; unknown (future) actions fall back to the code.
  const label = (action: string) => (at.has(action.replace(/\./g, "_") as never) ? at(action.replace(/\./g, "_") as never) : action);
  const when = (d: Date) => format.dateTime(new Date(d), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-left">
      <Card>
        <h2 className="text-lg font-semibold">{home("needsAttention")}</h2>
        <p className="mt-2">
          <Link href={{ pathname: "/stores", query: { status: "pending" } }} className="font-semibold underline underline-offset-4">
            {home("pendingStores", { count: s.stores.pending })}
          </Link>
        </p>
        <p className="mt-2">
          <Link href="/moderation" className="font-semibold underline underline-offset-4">
            {t("pendingTexts", { count: s.pendingTexts })}
          </Link>
        </p>
        <p className="mt-2" data-testid="dash-season">
          {t("seasonLine", { year: s.season.year })} {t(`phase.${s.season.phase}`)} · {s.season.storeWindowOpen ? t("windowOpen") : t("windowClosed")} ·{" "}
          <Link href="/season" className="underline underline-offset-4">
            {t("seasonLink")}
          </Link>
        </p>
      </Card>
      <Tiles
        title={t("storesTitle")}
        tiles={[
          { label: t("stores.approved"), value: s.stores.approved, href: { pathname: "/stores", query: { status: "approved" } } },
          { label: t("stores.invited"), value: s.stores.invited, href: { pathname: "/stores", query: { status: "invited" } } },
          { label: t("stores.suspended"), value: s.stores.suspended, href: { pathname: "/stores", query: { status: "suspended" } } },
          { label: t("items.active"), value: s.items.active },
          { label: t("items.draft"), value: s.items.draft },
          { label: t("items.hidden"), value: s.items.hidden },
        ]}
      />
      <Tiles
        title={t("usersTitle")}
        tiles={[
          { label: t("users.parent"), value: s.users.parent, href: { pathname: "/users", query: { role: "parent", status: "active" } } },
          { label: t("users.store_owner"), value: s.users.store_owner, href: { pathname: "/users", query: { role: "store_owner", status: "active" } } },
          { label: t("users.store_rep"), value: s.users.store_rep, href: { pathname: "/users", query: { role: "store_rep", status: "active" } } },
          { label: t("users.admin"), value: s.users.admin, href: { pathname: "/users", query: { role: "admin", status: "active" } } },
          { label: t("users.pending"), value: s.users.pending, href: { pathname: "/users", query: { status: "pending" } } },
          { label: t("users.suspended"), value: s.users.suspended, href: { pathname: "/users", query: { status: "suspended" } } },
        ]}
      />
      <Tiles
        title={t("activityTitle")}
        tiles={[
          { label: t("deeds"), value: s.deeds, href: "/deeds" },
          { label: t("views"), value: s.views },
          { label: t("onLists"), value: s.onLists },
        ]}
      />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("recentTitle")}</h2>
        {s.activity.length === 0 ? (
          <p className="text-sm text-muted">{t("recentEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="recent-activity">
            {s.activity.map((a, i) => (
              <li key={i}>
                <span className="text-muted">{when(a.at)}</span> · {label(a.action)} · {a.by}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">{t("laterNote")}</p>
      </Card>
    </div>
  );
}

export default async function Home() {
  const t = await getTranslations("HomePage");
  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-xl text-lg">{t("intro")}</p>
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
