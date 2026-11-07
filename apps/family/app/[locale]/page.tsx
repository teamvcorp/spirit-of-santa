/**
 * Family home. Signed out: what this is + sign up / sign in. Signed-in parent: the KID SELECTOR
 * (the default view on the family's device). The parent area is behind the PIN (/parent).
 * Phase 8.5 "Winter Night": the only page with falling snow; the hero picture follows the device
 * (snowy day in light mode, starry night in dark mode); illustrations come from ILLUSTRATIONS.
 */
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { listKids } from "@repo/families/kids";
import { formatPoints } from "@repo/lib/format";
import { buttonClass } from "@repo/ui/button";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { ILLUSTRATIONS } from "@/lib/illustrations";
import { Snowfall } from "../../components/snowfall";

async function Personal() {
  await connection();
  const user = await getSessionUser(authOptions);
  const t = await getTranslations("HomePage");
  if (user?.role !== "parent") {
    return (
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/register" className={buttonClass("festive", undefined, "lg")}>
          {t("signUp")}
        </Link>
        <Link href="/signin" className={buttonClass("secondary", undefined, "lg")}>
          {t("signIn")}
        </Link>
      </div>
    );
  }
  const kids = await listKids({ id: user.id, familyId: user.familyId });
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 text-left">
      <h2 className="text-2xl font-bold">{t("whoIsHere")}</h2>
      {kids.length === 0 ? (
        <p className="text-muted">{t("noKidsYet")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="kid-selector">
          {kids.map((k) => (
            <li key={k.id}>
              <Link
                href={`/kids/${k.id}`}
                className="flex h-full flex-col gap-2 rounded-3xl border border-foreground/10 bg-surface p-4 no-underline shadow-card transition hover:border-accent focus-visible:border-accent"
              >
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-accent font-display text-2xl font-bold text-on-accent">
                  {k.firstName.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-lg font-extrabold">{k.firstName}</span>
                <span className="text-sm font-bold text-accent-text">{t("points", { points: formatPoints(k.availableCentipoints) })}</span>
                {!k.registered && <span className="self-start rounded-full border border-foreground/25 px-2 text-xs">{t("awaiting")}</span>}
              </Link>
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
    <main className="flex flex-1 flex-col">
      {/* Hero: snowy day by default, starry night when the device is in dark mode. */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#dde8f7] to-background dark:from-[#0b1530] dark:via-[#14244a] dark:to-background">
        <Snowfall />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 pt-8 text-center">
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">{t("title")}</h1>
          <p className="max-w-xl text-lg text-muted">{t("intro")}</p>
          <picture className="block w-full max-w-md">
            <source srcSet={ILLUSTRATIONS.houseNight} media="(prefers-color-scheme: dark)" />
            {/* Plain <img> inside <picture>: the browser picks day/night art by the device's mode (next/image can't). */}
            <img src={ILLUSTRATIONS.houseDay} alt="" width={390} height={300} className="h-auto w-full [mask-image:linear-gradient(to_bottom,black_82%,transparent)]" />
          </picture>
        </div>
      </section>
      <div className="flex flex-col items-center gap-6 px-6 pb-10 pt-2 text-center">
        <Suspense fallback={null}>
          <Personal />
        </Suspense>
      </div>
    </main>
  );
}
