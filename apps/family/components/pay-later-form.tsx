"use client";
/**
 * "Pay later by text" opt-in form (Phase 5 slice 4). The consent wording is REGISTERED with the
 * carriers (Toll-Free Verification, docs/vendor/twilio.md + twilio-optin-form.png): keep it exactly
 * in messages PayLater.consent; never pre-tick the box; one text per request.
 *
 * mode "preview": the public /text-messages page (what reviewers and visitors see); the button is
 * disabled because there is no deed to pay for. Slice 4b uses mode "live" on each deed page.
 */
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { Link } from "@/i18n/navigation";

export function PayLaterConsentText() {
  const t = useTranslations("PayLater");
  return (
    <>
      {t("consent")}{" "}
      <Link href="/privacy" className="underline underline-offset-2">
        {t("privacy")}
      </Link>
      {" · "}
      <Link href="/terms" className="underline underline-offset-2">
        {t("terms")}
      </Link>
    </>
  );
}

export function PayLaterFields({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations("PayLater");
  return (
    <>
      <TextField label={t("phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-0123" maxLength={20} required disabled={disabled} />
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        {/* NEVER defaultChecked: consent must be an active choice. */}
        <input type="checkbox" name="consent" value="yes" required disabled={disabled} className="mt-1 size-5 shrink-0" />
        <span>
          <PayLaterConsentText />
        </span>
      </label>
    </>
  );
}

/** The opt-in form as shown on /text-messages (no deed: button disabled, nothing is sent). */
export function PayLaterPreview() {
  const t = useTranslations("PayLater");
  return (
    <form className="flex flex-col gap-4" aria-describedby="paylater-preview-note" onSubmit={(e) => e.preventDefault()}>
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <PayLaterFields disabled />
      <Button type="submit" disabled className="self-start">
        {t("button")}
      </Button>
      <p id="paylater-preview-note" className="text-xs text-foreground/70">
        {t("previewNote")}
      </p>
    </form>
  );
}
