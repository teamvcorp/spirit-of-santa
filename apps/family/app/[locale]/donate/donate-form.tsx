"use client";
/**
 * Community gift: "all children" or "children in one ZIP" + amount → Stripe's Embedded Checkout
 * IN this page (card details go straight to Stripe's iframe). Form keyed by nonce, defaults from
 * the echoed values (see lib/amount-form.ts: React 19 resets forms after an action).
 */
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { DONATION_PRESETS_CENTS, MAX_DONATION_CENTS, MIN_DONATION_CENTS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AmountPicker } from "../../../components/amount-picker";
import { communityDonateAction, type CommunityState } from "./actions";

// Module scope: one Stripe.js load per page (Stripe's guidance).
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

/** Inner fields: remount (key) resets `scope` to the echoed value. */
function ScopeFields({ scope: initialScope, zip }: { scope?: string; zip?: string }) {
  const t = useTranslations("Community");
  const start = initialScope === "zip" ? "zip" : "all";
  const [scope, setScope] = useState(start);
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("who")}</legend>
        {(["all", "zip"] as const).map((s) => (
          <label key={s} className="flex items-center gap-2">
            <input type="radio" name="scope" value={s} defaultChecked={start === s} onChange={() => setScope(s)} className="size-5" />
            {t(s === "all" ? "all" : "zipChoice")}
          </label>
        ))}
      </fieldset>
      {scope === "zip" && (
        <TextField label={t("zipLabel")} hint={t("zipNote")} name="zip" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5} required defaultValue={zip ?? ""} />
      )}
    </>
  );
}

export function CommunityDonateForm() {
  const t = useTranslations("Community");
  const [state, action, pending] = useActionState(communityDonateAction, { status: "idle" } as CommunityState);
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
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {error && (
        <Alert tone="error">
          {error === "amount" ? t("errors.amount", { min: formatCents(MIN_DONATION_CENTS), max: formatCents(MAX_DONATION_CENTS) }) : t(`errors.${error}` as never)}
        </Alert>
      )}
      <LocaleField />
      <ScopeFields scope={state.scope} zip={state.zip} />
      <AmountPicker
        values={state.values}
        initial={DONATION_PRESETS_CENTS[1]}
        presets={DONATION_PRESETS_CENTS}
        legend={t("amount")}
        otherLabel={t("other")}
        otherAmountLabel={t("otherAmount")}
      />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("button")}
      </Button>
      <p className="text-xs text-muted">{t("final")}</p>
    </form>
  );
}
