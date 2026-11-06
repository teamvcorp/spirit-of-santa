/**
 * Children's Privacy Notice (COPPA). DRAFT: the wording must be reviewed by a lawyer before launch.
 * The version parents agree to is PARENT_CONSENT_VERSION (@repo/lib/family): bump it with any change.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PARENT_CONSENT_VERSION } from "@repo/lib/family";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";

// "visitors" + "texts" (2026-11-06): people who tip/donate, and pay-later text messages (carrier requirement:
// mobile numbers are not shared for marketing). Registered with the carriers: keep /privacy public.
const SECTIONS = ["collect", "public", "share", "visitors", "texts", "consent", "rights", "keep", "contact"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Privacy");
  return { title: t("title") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <Card>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-4 mt-1 text-sm text-foreground/70">{t("version", { version: PARENT_CONSENT_VERSION })}</p>
        <Alert className="mb-6">{t("draft")}</Alert>
        <p className="mb-6">{t("intro")}</p>
        {SECTIONS.map((s) => (
          <section key={s} className="mb-6">
            <h2 id={s} className="mb-2 text-lg font-semibold">{t(`sections.${s}.title`)}</h2>
            <p className="whitespace-pre-line">{t(`sections.${s}.body`)}</p>
          </section>
        ))}
      </Card>
    </main>
  );
}
