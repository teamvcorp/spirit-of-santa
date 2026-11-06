/**
 * Family home. Signed out: what this is + sign up / sign in. Signed-in parent: the KID SELECTOR
 * (the default view on the family's device). The parent area is behind the PIN (/parent).
 */
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { listKids } from "@repo/families/kids";
import { formatPoints } from "@repo/lib/format";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";

async function Personal() {
  await connection();
  const user = await getSessionUser(authOptions);
  const t = await getTranslations("HomePage");
  if (user?.role !== "parent") {
    return (
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/register" className="rounded-lg bg-brand-red px-5 py-3 font-semibold text-white hover:bg-brand-red-dark">
          {t("signUp")}
        </Link>
        <Link href="/signin" className="rounded-lg border border-current px-5 py-3 font-semibold">
          {t("signIn")}
        </Link>
      </div>
    );
  }
  const kids = await listKids({ id: user.id, familyId: user.familyId });
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <h2 className="text-xl font-semibold">{t("whoIsHere")}</h2>
      {kids.length === 0 ? (
        <p className="text-foreground/70">{t("noKidsYet")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="kid-selector">
          {kids.map((k) => (
            <li key={k.id} className="rounded-2xl border border-foreground/15 p-4 text-left">
              <Link href={`/kids/${k.id}`} className="text-lg font-semibold underline underline-offset-4">
                {k.firstName}
              </Link>
              <p className="text-sm text-foreground/70">{t("points", { points: formatPoints(k.availableCentipoints) })}</p>
              {!k.registered && <span className="mt-2 inline-block rounded-full border border-foreground/30 px-2 text-xs">{t("awaiting")}</span>}
            </li>
          ))}
        </ul>
      )}
      <Link href="/parent" className="self-start text-sm underline underline-offset-4">
        {t("parentArea")}
      </Link>
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
        <Personal />
      </Suspense>
    </main>
  );
}
