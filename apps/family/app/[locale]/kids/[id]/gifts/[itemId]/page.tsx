/**
 * One gift (Phase 6 slice 2): photo, name, store, price in points, stock, and the kid's
 * "Add to my wish list" button (NO PIN). The page works out WHY a kid can't add (so the button
 * explains itself); the engine re-checks every rule when the button is pressed.
 * Opening the page counts one store "view" (recordItemView: hashed visitor, once a day, never
 * stores who looked; it never breaks the page if counting fails).
 */
import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { clientIp } from "@repo/auth/rate-limit";
import { getKid } from "@repo/families/kids";
import { formatPoints } from "@repo/lib/format";
import { MIN_CENTIPOINTS_TO_ADD_ITEM } from "@repo/lib/limits";
import { recordItemView } from "@repo/stores/engagement";
import { giftDetail, kidWishList } from "@repo/wishlists/catalog";
import { countsTowardCap } from "@repo/wishlists/rules";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";
import { AddGiftForm } from "./add-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Gifts");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/[locale]/kids/[id]/gifts/[itemId]">;

async function Content({ params }: Pick<Props, "params">) {
  await connection();
  const parent = await requireParent();
  const [{ id, itemId }, t] = await Promise.all([params, getTranslations("Gifts")]);
  const [kid, gift, list] = await Promise.all([getKid(parent, id), giftDetail(itemId), kidWishList(parent, id)]);
  if (!kid || !list) notFound();
  if (!gift) notFound(); // inactive item / store not approved / other season: same as missing

  const viewer = { familyId: parent.familyId ?? undefined, ip: clientIp(await headers()) };
  after(() => recordItemView(gift.id, viewer)); // after the page is sent: never slows it down

  // Same order as the engine checks them, so the hint matches what pressing would say.
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
            : kid.availableCentipoints < MIN_CENTIPOINTS_TO_ADD_ITEM
              ? "noPoints"
              : null;

  return (
    <>
      <Link href={`/kids/${kid.id}/gifts`} className="mb-4 inline-block text-sm underline underline-offset-4">
        ← {t("browseTitle")}
      </Link>
      <Card>
        <div className="grid gap-6 md:grid-cols-2">
          {gift.photoUrl ? (
            <Image src={gift.photoUrl} alt={t("photoAlt", { name: gift.name })} width={640} height={480} className="aspect-[4/3] w-full rounded-lg object-cover" priority />
          ) : (
            <div className="aspect-[4/3] w-full rounded-lg bg-foreground/5" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-bold">{gift.name}</h1>
            <p className="text-foreground/70">{t("fromStore", { store: gift.storeName })}</p>
            <p className="text-xl font-semibold" data-testid="gift-cost">
              {t("cost", { points: formatPoints(gift.costCentipoints) })}
              {gift.soldOut && <span className="ml-2 rounded bg-foreground/10 px-2 py-0.5 text-sm font-medium">{t("soldOut")}</span>}
            </p>
            {gift.description && <p className="whitespace-pre-line">{gift.description}</p>}
            <p className="text-sm">{t("youHave", { name: kid.firstName, points: formatPoints(kid.availableCentipoints) })}</p>
            <p className="text-sm text-foreground/70">{t("howFunding")}</p>
            <AddGiftForm kidId={kid.id} itemId={gift.id} blocked={blocked} cap={kid.itemCap} />
          </div>
        </div>
      </Card>
    </>
  );
}

export default function GiftPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <Suspense fallback={null}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}
