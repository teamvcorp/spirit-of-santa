/**
 * Terms of Service. DRAFT: the wording must be reviewed by a lawyer before launch. Includes the
 * text-message (SMS) terms registered with the carriers (docs/vendor/twilio.md). Bump TERMS_VERSION
 * with any change.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TERMS_VERSION } from "@repo/lib/family";
import { CENTS_PER_POINT } from "@repo/lib/constants";
import { formatCents } from "@repo/lib/format";
import { PAY_LATER_LINK_DAYS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { LegalSections } from "../../../components/legal-sections";

const SECTIONS = ["about", "accounts", "points", "payments", "donations", "season", "texts", "conduct", "changes", "contact"] as const;

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
        <p className="mb-4 mt-1 text-sm text-muted">{t("version", { version: TERMS_VERSION })}</p>
        <Alert className="mb-6">{t("draft")}</Alert>
        {/* Rate + days from the server constants (never hard-coded in the wording). */}
        <LegalSections namespace="Terms" keys={SECTIONS} values={{ days: PAY_LATER_LINK_DAYS, rate: formatCents(CENTS_PER_POINT) }} />
      </Card>
    </main>
  );
}
