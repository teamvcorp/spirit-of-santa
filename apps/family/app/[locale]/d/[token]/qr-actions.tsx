"use client";
/**
 * "Say thank you" and "Leave a tip" on the public deed page. The tip amount is re-checked on the
 * server; Stripe's form opens IN the page (card details go straight to Stripe).
 */
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { LocaleField } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { THANK_NOTES } from "@repo/lib/thank-notes";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AmountPicker } from "../../../../components/amount-picker";
import { thankAction, tipAction, type ThankState, type TipState } from "./actions";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

/** `rate`: the dollars-per-point text, from the server constant (never hard-coded). */
/**
 * canTip = giving is open (until the freeze date); `giving` = the server-rendered small line (note or "closed");
 * `payLater` = the "Pay later by text" section (server-rendered, passed in so it can be HIDDEN while Stripe's form is
 * open: on phones it sat right under the card form and people took it for the only way to pay, owner 2026-11-08).
 */
export function QrActions({ token, kidName, rate, canTip, giving, payLater }: { token: string; kidName: string; rate: string; canTip: boolean; giving: ReactNode; payLater?: ReactNode }) {
  const t = useTranslations("Qr");
  const [thank, thankFormAction, thanking] = useActionState(thankAction, { status: "idle" } as ThankState);
  const [tip, tipFormAction, tipping] = useActionState(tipAction, { status: "idle" } as TipState);
  const hydrated = useHydrated();
  // "Change amount" closes the card form: remember WHICH checkout was closed (a new tip gets a new secret).
  const [closedSecret, setClosedSecret] = useState<string | null>(null);
  const paying = "ok" in tip && tip.ok && tip.clientSecret !== closedSecret;
  const checkoutTop = useRef<HTMLDivElement>(null);
  const tipHeading = useRef<HTMLHeadingElement>(null);
  const wasPaying = useRef(false);
  useEffect(() => {
    // On a phone the page stays scrolled where the tip button was, i.e. halfway down Stripe's form. Start at its top.
    if (paying) checkoutTop.current?.scrollIntoView({ block: "start" });
    // "Change amount" removes the button that had focus: put keyboard/screen-reader users back at the tip choices.
    else if (wasPaying.current) tipHeading.current?.focus();
    wasPaying.current = paying;
  }, [paying]);

  if (thank.status === "done") return <Alert>{t("thanked", { name: kidName })}</Alert>;
  const tipError = "ok" in tip && !tip.ok ? tip.error : null;
  return (
    <div className="flex flex-col gap-6">
      {paying &&
        (stripePromise ? (
          <div ref={checkoutTop} className="flex scroll-mt-4 flex-col gap-3">
            <p className="font-semibold">{t("tipTotal", { amount: formatCents(tip.amountCents) })}</p>
            {/* Stripe's own button is labelled "Donate" (submit_type) and sits at the BOTTOM of a long form. */}
            <p className="text-sm text-muted" data-testid="pay-hint">{t("payHint")}</p>
            <button type="button" onClick={() => setClosedSecret(tip.clientSecret)} className="self-start text-sm font-semibold underline underline-offset-4">
              {t("changeAmount")}
            </button>
            <div data-testid="stripe-checkout">
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: tip.clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        ) : (
          <Alert tone="error">{t("errors.stripe")}</Alert>
        ))}
      {/* HIDDEN, not removed, while paying: the forms keep what was typed and "Pay later" remembers a text it already
          sent (review of 2f58ee9). Tailwind's base style makes [hidden] display:none !important, so it beats flex. */}
      <div hidden={paying} className="flex flex-col gap-6">
        <form action={thankFormAction} className="flex flex-col gap-2">
          {thank.status === "error" && thank.error && <Alert tone="error">{t(`errors.${thank.error}` as never)}</Alert>}
          <input type="hidden" name="token" value={token} />
          {/* Optional READY-MADE note (owner 2026-11-07): never free text to a child; the parent approves it first. */}
          <fieldset className="flex flex-col gap-1" data-testid="thank-note">
            <legend className="mb-1 font-medium">{t("noteLegend")}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="note" value="" defaultChecked className="size-4" />
              {t("noNote")}
            </label>
            {THANK_NOTES.map((n) => (
              <label key={n} className="flex items-center gap-2">
                <input type="radio" name="note" value={n} className="size-4" />
                {t(`notes.${n}`)}
              </label>
            ))}
            <p className="text-sm text-muted">{t("noteHelp")}</p>
          </fieldset>
          <Button type="submit" pending={thanking} disabled={!hydrated} className="self-start">
            {t("sayThanks")}
          </Button>
          <p className="text-sm text-muted">{t("sayThanksHelp")}</p>
        </form>
        {!canTip && giving}
        {canTip && <form key={tip.nonce ?? "initial"} action={tipFormAction} className="flex flex-col gap-3 border-t border-foreground/15 pt-6">
          <h2 ref={tipHeading} tabIndex={-1} className="text-lg font-semibold">{t("tipTitle")}</h2>
          <p className="text-sm text-muted">{t("tipHelp", { rate })}</p>
          {tipError && (
            <Alert tone="error">
              {tipError === "amount" ? t("errors.amount", { min: formatCents(MIN_TIP_CENTS), max: formatCents(MAX_TIP_CENTS) }) : t(`errors.${tipError}` as never)}
            </Alert>
          )}
          <LocaleField />
          <input type="hidden" name="token" value={token} />
          <AmountPicker values={tip.values} initial={TIP_PRESETS_CENTS[0]} legend={t("tipTitle")} otherLabel={t("other")} otherAmountLabel={t("otherAmount")} />
          <Button type="submit" variant="secondary" pending={tipping} disabled={!hydrated} className="self-start">
            {t("tipButton")}
          </Button>
          <p className="text-xs text-muted">{t("final")}</p>
          {giving}
        </form>}
        {payLater}
      </div>
    </div>
  );
}
