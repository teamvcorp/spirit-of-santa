/**
 * Terms of Service. DRAFT: the wording must be reviewed by a lawyer before launch. Includes the
 * text-message (SMS) terms registered with the carriers (docs/vendor/twilio.md). Bump TERMS_VERSION
 * with any change.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TERMS_VERSION } from "@repo/lib/family";
import { PAY_LATER_LINK_DAYS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";

const SECTIONS = ["about", "accounts", "points", "payments", "donations", "texts", "conduct", "changes", "contact"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Terms");
  return { title: t("title") };
}

export default async function TermsPage() {
  const t = await getTranslations("Terms");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Card>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-4 mt-1 text-sm text-foreground/70">{t("version", { version: TERMS_VERSION })}</p>
        <Alert className="mb-6">{t("draft")}</Alert>
        {SECTIONS.map((s) => (
          <section key={s} id={s} className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">{t(`sections.${s}.title`)}</h2>
            <p className="whitespace-pre-line">{t(`sections.${s}.body`, { days: PAY_LATER_LINK_DAYS })}</p>
          </section>
        ))}
      </Card>
    </main>
  );
}
