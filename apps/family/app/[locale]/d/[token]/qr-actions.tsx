"use client";
/**
 * "Say thank you" and "Leave a tip" on the public deed page. The tip amount is re-checked on the
 * server; Stripe's form opens IN the page (card details go straight to Stripe).
 */
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { thankAction, tipAction, type ThankState, type TipState } from "./actions";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

/** `rate`: the dollars-per-point text, from the server constant (never hard-coded). */
export function QrActions({ token, kidName, rate }: { token: string; kidName: string; rate: string }) {
  const t = useTranslations("Qr");
  const [thank, thankFormAction, thanking] = useActionState(thankAction, { status: "idle" } as ThankState);
  const [tip, tipFormAction, tipping] = useActionState(tipAction, { status: "idle" } as TipState);
  const [amount, setAmount] = useState(String(TIP_PRESETS_CENTS[0]));
  const hydrated = useHydrated();

  if (thank.status === "done") return <Alert>{t("thanked", { name: kidName })}</Alert>;
  if ("ok" in tip && tip.ok) {
    if (!stripePromise) return <Alert tone="error">{t("errors.stripe")}</Alert>;
    return (
      <div className="flex flex-col gap-3">
        <p className="font-semibold">{t("tipTotal", { amount: formatCents(tip.amountCents) })}</p>
        <div data-testid="stripe-checkout">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: tip.clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }
  const tipError = "ok" in tip && !tip.ok ? tip.error : null;
  return (
    <div className="flex flex-col gap-6">
      <form action={thankFormAction} className="flex flex-col gap-2">
        {thank.status === "error" && thank.error && <Alert tone="error">{t(`errors.${thank.error}` as never)}</Alert>}
        <input type="hidden" name="token" value={token} />
        <Button type="submit" pending={thanking} disabled={!hydrated} className="self-start">
          {t("sayThanks")}
        </Button>
        <p className="text-sm text-foreground/70">{t("sayThanksHelp")}</p>
      </form>
      <form action={tipFormAction} className="flex flex-col gap-3 border-t border-foreground/15 pt-6">
        <h2 className="text-lg font-semibold">{t("tipTitle")}</h2>
        <p className="text-sm text-foreground/70">{t("tipHelp", { rate })}</p>
        {tipError && (
          <Alert tone="error">
            {tipError === "amount" ? t("errors.amount", { min: formatCents(MIN_TIP_CENTS), max: formatCents(MAX_TIP_CENTS) }) : t(`errors.${tipError}` as never)}
          </Alert>
        )}
        <LocaleField />
        <input type="hidden" name="token" value={token} />
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">{t("tipTitle")}</legend>
          {TIP_PRESETS_CENTS.map((c) => (
            <label key={c} className="flex items-center gap-2 rounded-lg border border-foreground/20 px-4 py-2">
              <input type="radio" name="amount" value={String(c)} checked={amount === String(c)} onChange={() => setAmount(String(c))} />
              {formatCents(c)}
            </label>
          ))}
          <label className="flex items-center gap-2 rounded-lg border border-foreground/20 px-4 py-2">
            <input type="radio" name="amount" value="other" checked={amount === "other"} onChange={() => setAmount("other")} />
            {t("other")}
          </label>
        </fieldset>
        {amount === "other" && <TextField label={t("otherAmount")} name="other" inputMode="decimal" required maxLength={10} />}
        <Button type="submit" variant="secondary" pending={tipping} disabled={!hydrated} className="self-start">
          {t("tipButton")}
        </Button>
        <p className="text-xs text-foreground/70">{t("final")}</p>
      </form>
    </div>
  );
}
