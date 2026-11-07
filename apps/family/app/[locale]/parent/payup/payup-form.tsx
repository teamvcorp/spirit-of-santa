"use client";
/**
 * One "Finish this gift for $X" button. On success the same spot shows Stripe's embedded form
 * (like the bonus page). The amount shown comes from the server; the server recomputes it anyway.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { payUpAction, type PayUpState } from "./actions";

// Module scope: one Stripe.js load per page (Stripe's guidance).
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function PayUpForm({ wishId, cents, label }: { wishId: string; cents: number; label: string }) {
  const t = useTranslations("PayUp");
  const [state, action, pending] = useActionState(payUpAction, { status: "idle" } as PayUpState);
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
    <form action={action} className="flex flex-col gap-2">
      {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}
      <LocaleField />
      <input type="hidden" name="wishId" value={wishId} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start" aria-label={label}>
        {t("button", { amount: formatCents(cents) })}
      </Button>
    </form>
  );
}
