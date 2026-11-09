/**
 * /kids/<id>/surprise/<itemId>: one gift, "Add as a surprise" (owner 2026-11-08). Behind the parent PIN.
 * The page works out WHY it can't be added (so the button explains itself); addSurprise re-checks every rule.
 * Unlike the child's gift page: no "≥ 1 Christmas Magic" rule, and "already listed" counts surprises too.
 * Doesn't count a store "view" (that number is about children's interest).
 */
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKid } from "@repo/families/kids";
import { formatCents, formatPoints } from "@repo/lib/format";
import { normalizeObjectId } from "@repo/lib/ids";
import { giftDetail, kidWishList } from "@repo/wishlists/catalog";
import { payUpCents } from "@repo/wishlists/payup";
import { countsTowardCap } from "@repo/wishlists/rules";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireUnlockedPage } from "@/lib/parent";
import { SeasonGate } from "@/components/season-gate";
import { AddSurpriseForm } from "./add-surprise-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Surprise");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/kids/[id]/surprise/[itemId]">;

async function Content({ params }: Pick<Props, "params">) {
  await connection();
  const { id, itemId } = await params;
  const kidId = normalizeObjectId(id);
  const giftId = normalizeObjectId(itemId);
  if (!kidId || !giftId) notFound();
  const parent = await requireUnlockedPage(`/kids/${kidId}/surprise/${giftId}`);
  const [kid, gift, list, t, g] = await Promise.all([getKid(parent, kidId), giftDetail(giftId), kidWishList(parent, kidId, undefined, { reveal: true }), getTranslations("Surprise"), getTranslations("Gifts")]);
  if (!kid || !list || !gift) notFound();

  // Same order as the engine checks them.
  const blocked = !list.seasonOpen
    ? "seasonNotOpen"
    : !kid.registered
      ? "notRegistered"
      : gift.soldOut
        ? "soldOut"
        : list.rows.some((r) => r.itemId === gift.id && countsTowardCap(r.status))
          ? "alreadyListed"
          : list.onList >= kid.itemCap
            ? "cap"
            : null;
  // What paying it off in one go would cost: the SAME rule as the checkout (payUpCents, $1.50 per Christmas Magic).
  const fullCents = payUpCents(gift.costCentipoints);

  return (
    <>
      <Link href={`/kids/${kid.id}/surprise`} className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("title")}
      </Link>
      <Card>
        <div className="grid gap-6 md:grid-cols-2">
          {gift.photoUrl ? (
            <Image src={gift.photoUrl} alt={g("photoAlt", { name: gift.name })} width={640} height={480} className="aspect-[4/3] w-full rounded-lg object-cover" priority />
          ) : (
            <div className="aspect-[4/3] w-full rounded-lg bg-foreground/5" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold">{gift.name}</h1>
            <p className="text-muted">{g("fromStore", { store: gift.storeName })}</p>
            <p className="font-display text-3xl font-bold text-accent-text" data-testid="gift-cost">
              {g("cost", { points: formatPoints(gift.costCentipoints) })}
              {gift.soldOut && <span className="ml-2 rounded bg-foreground/10 px-2 py-0.5 text-sm font-medium">{g("soldOut")}</span>}
            </p>
            {gift.description && <p className="whitespace-pre-line">{gift.description}</p>}
            <p className="text-sm">{t("how", { name: kid.firstName, amount: formatCents(fullCents) })}</p>
            <AddSurpriseForm kidId={kid.id} itemId={gift.id} blocked={blocked} cap={kid.itemCap} />
          </div>
        </div>
      </Card>
    </>
  );
}

export default function SurpriseGiftPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <SeasonGate>
        <Suspense fallback={null}>
          <Content params={props.params} />
        </Suspense>
      </SeasonGate>
    </main>
  );
}
