/**
 * "Remove from the wish list?" (Phase 6 slice 2). PARENT PIN required (product decision
 * 2026-11-06: kids add, parents remove). A locked parent goes to the PIN page and comes BACK
 * here afterwards (`requireUnlockedPage(next)`, path allow-listed in safeNext).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { formatPoints } from "@repo/lib/format";
import { normalizeObjectId } from "@repo/lib/ids";
import { kidWishList } from "@repo/wishlists/catalog";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { RemoveGiftForm } from "./remove-form";
import { SeasonGate } from "@/components/season-gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Gifts");
  return { title: t("removeTitle"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/kids/[id]/wishlist/[wid]/remove">;

async function Content({ params }: Pick<Props, "params">) {
  await connection();
  const { id, wid } = await params;
  const kidId = normalizeObjectId(id);
  const wishId = normalizeObjectId(wid);
  if (!kidId || !wishId) notFound();
  const parent = await requireUnlockedPage(`/kids/${kidId}/wishlist/${wishId}/remove`);
  const [kid, list, t] = await Promise.all([getKid(parent, kidId), kidWishList(parent, kidId, undefined, { reveal: true }), getTranslations("Gifts")]); // PIN page: the parent sees what a surprise really is
  const row = list?.rows.find((r) => r.id === wishId);
  if (!kid || !row) notFound();
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-bold">{t("removeTitle")}</h1>
      {row.removable ? (
        <>
          <p className="mb-4">{t("removeIntro", { item: row.name, name: kid.firstName, points: formatPoints(row.fundedCentipoints) })}</p>
          <RemoveGiftForm kidId={kid.id} wishId={row.id} />
        </>
      ) : (
        <>
          <Alert tone="error" className="mb-4">{t(list!.seasonOpen ? "removeErrors.locked" : "removeErrors.seasonNotOpen")}</Alert>
          <Link href={`/kids/${kid.id}#wishlist`} className="underline underline-offset-4">
            {t("keep")}
          </Link>
        </>
      )}
    </Card>
  );
}

export default function RemoveGiftPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <SeasonGate>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
