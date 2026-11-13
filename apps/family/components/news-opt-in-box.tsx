"use client";
/**
 * "Keep me posted" box on the donate / tip / donation-link forms (owner 2026-11-12). NEVER pre-ticked. When ticked,
 * the checkout carries sos_news; after the payment the payer gets a CONFIRM link at the email they typed in Stripe
 * (nothing is added to the news list until they click it). Adults only: the label says so.
 */
import { useTranslations } from "next-intl";

export function NewsOptInBox() {
  const t = useTranslations("News");
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name="news" value="on" className="mt-0.5 size-5 shrink-0" data-testid="news-opt-in" />
      <span>{t("afterPayment")}</span>
    </label>
  );
}
