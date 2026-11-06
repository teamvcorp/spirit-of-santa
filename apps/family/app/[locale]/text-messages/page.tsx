/**
 * /text-messages: public page about our ONE kind of text message, "pay later" tip links (Phase 5
 * slice 4). Registered with the carriers as the opt-in proof URL (Toll-Free Verification,
 * docs/vendor/twilio.md): it must stay public and show the same form + wording as the deed pages.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PAY_LATER_LINK_DAYS } from "@repo/lib/limits";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { LegalSections } from "../../../components/legal-sections";
import { PayLaterPreview } from "../../../components/pay-later-form";

const SECTIONS = ["how", "what", "frequency", "stop", "privacy"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TextMessages");
  return { title: t("title"), description: t("intro") };
}

export default async function TextMessagesPage() {
  const t = await getTranslations("TextMessages");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Card>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 mt-2">{t("intro")}</p>
        <LegalSections namespace="TextMessages" keys={SECTIONS} values={{ days: PAY_LATER_LINK_DAYS }} />
        <div className="mt-6 rounded-xl border border-foreground/15 p-4">
          <p className="mb-3 text-sm text-foreground/70">{t("formIntro")}</p>
          <PayLaterPreview />
        </div>
        <p className="mt-6 text-sm">
          <Link href="/privacy" className="underline underline-offset-4">
            {t("privacyLink")}
          </Link>
          {" · "}
          <Link href="/terms" className="underline underline-offset-4">
            {t("termsLink")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
