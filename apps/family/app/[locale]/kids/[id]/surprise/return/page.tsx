/**
 * Stripe sends the parent back here after "Fund it now" on a surprise (owner 2026-11-08). Same check as the pay-up
 * return page (payUpStatus: this family's pay-up sessions only; records a paid one right away). Signed-in parent
 * only, NOT the PIN (the unlock cookie may not survive the redirect back from Stripe). Shows no gift name, so it
 * gives nothing away if a child picks up the device.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { payUpStatus } from "@repo/families/payup";
import { normalizeObjectId } from "@repo/lib/ids";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { requireParent } from "@/lib/parent";

type Props = PageProps<"/[locale]/kids/[id]/surprise/return">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Surprise");
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function Status({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  await connection();
  const parent = await requireParent();
  const [{ id }, sp, t] = await Promise.all([params, searchParams, getTranslations("Surprise")]);
  const sid = sp.session_id;
  const status = typeof sid === "string" ? await payUpStatus(parent, sid) : null;
  const msg = status === "credited" ? t("paid") : status === "processing" ? t("processing") : status === "review" ? t("review") : status === "open" ? t("notPaid") : t("unknown");
  const kidId = normalizeObjectId(id);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone={status === "credited" || status === "processing" ? "info" : "error"}>{msg}</Alert>
      <Link href={kidId ? `/kids/${kidId}/surprise` : "/parent"} className="underline underline-offset-4">
        {t("back")}
      </Link>
    </div>
  );
}

export default function SurpriseReturnPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-6">
      <Card>
        <Suspense fallback={null}>
          <Status params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}
