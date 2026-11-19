"use client";
/**
 * Store sign-up STEP 1 (email first, owner 2026-11-19): just the email. The server sends a "Register your store"
 * link and creates nothing else; it gives the SAME answer for every address (no "already registered" hint).
 *
 * - "company_url" is a honeypot: hidden from people and screen readers, bots fill it in (server fakes success).
 * - Submit is disabled until JavaScript is ready (see @repo/ui/use-hydrated for why).
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { INITIAL_FORM_STATE, type FormState } from "@repo/auth/form-state";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function EmailStepForm({ action }: { action: Action }) {
  const t = useTranslations("RegisterPage");
  const errorsT = useTranslations("Common.accounts.errors");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const locale = useLocale();
  const hydrated = useHydrated();

  if (state.status === "sent") {
    return (
      <Alert>
        <strong className="block">{t("sentTitle")}</strong>
        {t("sentBody")}
      </Alert>
    );
  }
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error)}</Alert>}
      <p>{t("emailIntro")}</p>
      <input type="hidden" name="locale" value={locale} />
      <TextField
        label={t("email")}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        defaultValue={state.values?.email}
        error={fieldError(state.fieldErrors?.email)}
      />
      {/* Honeypot (see header). Off-screen rather than display:none, which some bots skip. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company URL
          <input type="text" name="company_url" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {pending ? t("emailSending") : t("emailSubmit")}
      </Button>
    </form>
  );
}
