import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { storeStatusCounts } from "@repo/stores/queries";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";

/** Admin dashboard: what needs attention. Signed-out visitors just see the intro. */
async function Dashboard() {
  await connection();
  const user = await getSessionUser(authOptions);
  if (user?.role !== "admin") return null;
  if (user.mfaSetup) redirect("/mfa/setup"); // no admin data until MFA is set up
  const [counts, t] = await Promise.all([storeStatusCounts(), getTranslations("HomePage")]);
  return (
    <Card className="w-full max-w-md text-left">
      <h2 className="text-lg font-semibold">{t("needsAttention")}</h2>
      <p className="mt-2">
        <Link href={{ pathname: "/stores", query: { status: "pending" } }} className="font-semibold underline underline-offset-4">
          {t("pendingStores", { count: counts.pending })}
        </Link>
      </p>
    </Card>
  );
}

export default async function Home() {
  const t = await getTranslations("HomePage");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-xl text-lg">{t("intro")}</p>
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </main>
  );
}