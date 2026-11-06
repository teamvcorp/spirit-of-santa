"use client";
/** Donation amount → Stripe's embedded form (card details go straight to Stripe). */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AmountPicker } from "../../../../components/amount-picker";
import { donateAction, type DonateState } from "./actions";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function DonateForm({ token }: { token: string }) {
  const t = useTranslations("Donate");
  const [state, action, pending] = useActionState(donateAction, { status: "idle" } as DonateState);
  const hydrated = useHydrated();
  if ("ok" in state && state.ok) {
    if (!stripePromise) return <Alert tone="error">{t("errors.stripe")}</Alert>;
    return (
      <div className="flex flex-col gap-3">
        <p className="font-semibold">{t("total", { amount: formatCents(state.amountCents) })}</p>
        <div data-testid="stripe-checkout">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: state.clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }
  const error = "ok" in state && !state.ok ? state.error : null;
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      {error && (
        <Alert tone="error">
          {error === "amount" ? t("errors.amount", { min: formatCents(MIN_TIP_CENTS), max: formatCents(MAX_TIP_CENTS) }) : t(`errors.${error}` as never)}
        </Alert>
      )}
      <LocaleField />
      <input type="hidden" name="token" value={token} />
      <AmountPicker values={state.values} initial={TIP_PRESETS_CENTS[1]} legend={t("amount")} otherLabel={t("other")} otherAmountLabel={t("otherAmount")} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("button")}
      </Button>
      <p className="text-xs text-foreground/70">{t("final")}</p>
    </form>
  );
}
