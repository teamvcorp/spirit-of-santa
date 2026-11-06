"use client";
/**
 * "Pay later by text" on the deed page (Phase 5 slice 4b). REGISTERED with the carriers: the
 * shared PayLaterFields (exact consent wording, box never pre-ticked), one text per request.
 * Form keyed by nonce + echoed values (React 19 resets forms after an action; lib/amount-form.ts).
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AmountPicker } from "../../../../components/amount-picker";
import { PayLaterFields } from "../../../../components/pay-later-form";
import { payLaterAction, type PayLaterState } from "./actions";

const fmtDay = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" }).format(new Date(iso));

/** `sent`: a text was already sent for this deed (only one per deed). */
export function PayLaterSection({ token, sent }: { token: string; sent: { masked: string; expiresAt: string } | null }) {
  const t = useTranslations("PayLater");
  const locale = useLocale();
  const [state, action, pending] = useActionState(payLaterAction, { status: "idle" } as PayLaterState);
  const hydrated = useHydrated();
  const done = "ok" in state && state.ok ? state : sent;
  if (done) {
    return (
      <section className="flex flex-col gap-2 border-t border-foreground/15 pt-6">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <Alert>{t("sent", { phone: done.masked, day: fmtDay(done.expiresAt, locale) })}</Alert>
      </section>
    );
  }
  const error = "ok" in state && !state.ok ? state.error : null;
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3 border-t border-foreground/15 pt-6">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-sm text-foreground/70">{t("intro")}</p>
      {error && (
        <Alert tone="error">
          {error === "amount" ? t("errors.amount", { min: formatCents(MIN_TIP_CENTS), max: formatCents(MAX_TIP_CENTS) }) : t(`errors.${error}` as never)}
        </Alert>
      )}
      <LocaleField />
      <input type="hidden" name="token" value={token} />
      <AmountPicker values={state.values} initial={TIP_PRESETS_CENTS[0]} legend={t("amount")} otherLabel={t("other")} otherAmountLabel={t("otherAmount")} />
      <PayLaterFields phone={state.phone} />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("button")}
      </Button>
    </form>
  );
}
