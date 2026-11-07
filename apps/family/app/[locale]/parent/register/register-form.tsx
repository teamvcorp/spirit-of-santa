"use client";
/**
 * Choose kids (+ optional promo code) → server starts the registration → Stripe's Embedded
 * Checkout appears IN this page (no redirect). Card details go straight to Stripe (iframe from
 * js.stripe.com); they never touch our server. The webhook marks the kids registered.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { startRegistrationAction, type RegisterState } from "./actions";

// Module scope: one Stripe.js load per page, never re-created on render (Stripe's guidance).
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const INITIAL: RegisterState = { status: "idle" };

export function RegisterKidsForm({ kids, feeCents }: { kids: { id: string; firstName: string }[]; feeCents: number }) {
  const t = useTranslations("Register");
  const [state, action, pending] = useActionState(startRegistrationAction, INITIAL);
  const hydrated = useHydrated();

  if ("kind" in state && state.kind === "pay") {
    if (!stripePromise) return <Alert tone="error">{t("errors.stripe")}</Alert>;
    return (
      <div className="flex flex-col gap-4">
        <p>{t("payNow", { amount: formatCents(state.amountCents) })}</p>
        <div data-testid="stripe-checkout">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: state.clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }
  if ("kind" in state && state.kind === "free") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>{t("freeDone", { count: state.registered })}</Alert>
        <Link href="/parent" className="underline underline-offset-4">
          {t("back")}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {"kind" in state && state.kind === "error" && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <LocaleField />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("whichKids", { fee: formatCents(feeCents) })}</legend>
        {kids.map((k) => (
          <label key={k.id} className="flex items-center gap-2">
            <input type="checkbox" name="kid" value={k.id} defaultChecked className="size-5" />
            {k.firstName}
          </label>
        ))}
      </fieldset>
      <TextField label={t("promo")} hint={t("promoHint")} name="promo" autoComplete="off" maxLength={40} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("continue")}
      </Button>
      <p className="text-sm text-muted">{t("why")}</p>
    </form>
  );
}
