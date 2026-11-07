import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@repo/ui/button";

/** Request-time call to action: dashboard if signed in, else sign up / sign in. */
async function Cta() {
  await connection();
  const user = await getSessionUser(authOptions);
  const t = await getTranslations("HomePage");
  if (user) {
    return (
      <Link href="/dashboard" className={buttonClass("primary", "px-6 py-3")}>
        {t("dashboard")}
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Link href="/register" className={buttonClass("primary", "px-6 py-3")}>
        {t("register")}
      </Link>
      <Link href="/signin" className={buttonClass("secondary", "px-6 py-3")}>
        {t("signIn")}
      </Link>
    </div>
  );
}

export default async function Home() {
  const t = await getTranslations("HomePage");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-xl text-lg">{t("intro")}</p>
      <Suspense fallback={null}>
        <Cta />
      </Suspense>
    </main>
  );
}