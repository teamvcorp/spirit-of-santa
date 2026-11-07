"use client";
/**
 * Pick a registered child + an amount → server starts the bonus → Stripe's Embedded Checkout
 * appears IN this page (card details go straight to Stripe's iframe, never to our server).
 * Form keyed by nonce + defaults from the echo: see lib/amount-form.ts (React 19 form reset).
 */
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
import { bonusAction, type BonusState } from "./actions";

// Module scope: one Stripe.js load per page (Stripe's guidance).
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function BonusForm({ kids, preselect }: { kids: { id: string; firstName: string }[]; preselect?: string }) {
  const t = useTranslations("Bonus");
  const [state, action, pending] = useActionState(bonusAction, { status: "idle" } as BonusState);
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
  const picked = state.kid ?? preselect ?? (kids.length === 1 ? kids[0]!.id : undefined);
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {error && (
        <Alert tone="error">
          {error === "amount" ? t("errors.amount", { min: formatCents(MIN_TIP_CENTS), max: formatCents(MAX_TIP_CENTS) }) : t(`errors.${error}` as never)}
        </Alert>
      )}
      <LocaleField />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("whichKid")}</legend>
        {kids.map((k) => (
          <label key={k.id} className="flex items-center gap-2">
            <input type="radio" name="kid" value={k.id} required defaultChecked={picked === k.id} className="size-5" />
            {k.firstName}
          </label>
        ))}
      </fieldset>
      <AmountPicker values={state.values} initial={TIP_PRESETS_CENTS[1]} legend={t("amount")} otherLabel={t("other")} otherAmountLabel={t("otherAmount")} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("button")}
      </Button>
      <p className="text-xs text-muted">{t("final")}</p>
    </form>
  );
}
