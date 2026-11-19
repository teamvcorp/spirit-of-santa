/**
 * /partners/<slug>: where a tile on "Our stores" leads (owner 2026-11-18).
 *  - Signed-in parent, store approved, ONE registered kid → straight to that kid's gifts from this store.
 *  - Several registered kids → "Whose wish list?" (one link per kid).
 *  - Signed-in parent, no registered kid yet → a nudge to finish registering.
 *  - Store not approved yet (pending / processing) → "getting ready" (its items aren't visible to families).
 *  - Anyone else → sign up, "to see what wonders await".
 * Kid ids come only from listKids (this parent's own family, server-side); the slug is validated + looked up.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSessionUser } from "@repo/auth";
import { listKids } from "@repo/families/kids";
import { partnerBySlug } from "@repo/stores/partners";
import { buttonClass } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { Link } from "@/i18n/navigation";
import { goTo } from "@/lib/parent";
import { SeasonGate } from "@/components/season-gate";

type Props = PageProps<"/[locale]/partners/[slug]">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Partners");
  // A hop page, not content: keep it out of search results.
  return { title: t("title"), robots: { index: false, follow: true } };
}

async function Content({ params }: Pick<Props, "params">) {
  await connection();
  const { slug } = await params;
  const [partner, user, t] = await Promise.all([partnerBySlug(slug), getSessionUser(authOptions), getTranslations("Partners")]);
  if (!partner || partner.status === "declined") notFound();
  const gifts = (kidId: string) => `/kids/${kidId}/gifts?store=${encodeURIComponent(partner.slug)}`;

  // Not a signed-in parent: the invitation to join.
  if (user?.role !== "parent") {
    return (
      <Card>
        <h1 className="mb-2 text-2xl font-bold">{partner.name}</h1>
        <p className="mb-4 text-lg">{t("wonders")}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/register" className={buttonClass()} data-testid="partner-signup">
            {t("signUp")}
          </Link>
          <Link href="/signin" className="underline underline-offset-4">
            {t("signIn")}
          </Link>
        </div>
      </Card>
    );
  }

  const back = (
    <Link href="/partners" className="mt-4 inline-block underline underline-offset-4">
      ← {t("back")}
    </Link>
  );
  if (partner.status !== "approved") {
    return (
      <Card>
        <h1 className="mb-2 text-2xl font-bold">{partner.name}</h1>
        <p>{t("notReady", { store: partner.name })}</p>
        {back}
      </Card>
    );
  }
  const kids = (await listKids({ id: user.id, familyId: user.familyId })).filter((k) => k.registered);
  if (kids.length === 1) await goTo(gifts(kids[0]!.id)); // redirects (throws)
  if (kids.length === 0) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl font-bold">{partner.name}</h1>
        <p className="mb-4">{t("noKids")}</p>
        <Link href="/parent" className={buttonClass()}>
          {t("toParent")}
        </Link>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-bold">{partner.name}</h1>
      <p className="mb-4 text-lg">{t("chooseKid")}</p>
      <ul className="flex flex-col gap-2" data-testid="partner-kids">
        {kids.map((k) => (
          <li key={k.id}>
            <Link href={gifts(k.id)} className={buttonClass("secondary")}>
              {t("kidList", { name: k.firstName })}
            </Link>
          </li>
        ))}
      </ul>
      {back}
    </Card>
  );
}

export default function PartnerPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <SeasonGate>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
