"use client";
/**
 * Account forms shared by all apps: forgot password, resend verification, reset password,
 * confirm email. Each takes a Server Action (the app's wrapper around form-actions.ts).
 *
 * - useActionState: the form posts to the Server Action and shows its result. Submit stays
 *   disabled until JavaScript is ready (useHydrated): a pre-JS submit would run the action
 *   but, with Cache Components, not show its result.
 * - Messages come from the shared Common.accounts namespace (en + es).
 * - Token-based forms (reset, confirm) carry the token in a hidden field and only act on an
 *   explicit button press: email scanners that pre-open links can't trigger them.
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { INITIAL_FORM_STATE, type FormState } from "./form-state.ts";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./schemas.ts";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Translate a field error code (Common.formErrors.<code>). */
export function useFieldError() {
  // Codes come from the server at runtime, so look them up loosely; unknown → "invalid".
  const t = useTranslations("Common.formErrors") as unknown as {
    (key: string, values?: Record<string, string | number>): string;
    has(key: string): boolean;
  };
  return (code: string | undefined, values?: Record<string, string | number>) =>
    code ? (t.has(code) ? t(code, values) : t("invalid")) : undefined;
}

function FormError({ state }: { state: FormState }) {
  const t = useTranslations("Common.accounts.errors");
  if (state.status !== "error" || !state.error) return null;
  return <Alert tone="error">{t(state.error)}</Alert>;
}

/** Hidden field telling the Server Action which language to email in. */
function LocaleField() {
  return <input type="hidden" name="locale" value={useLocale()} />;
}

export function EmailRequestForm({ action, mode }: { action: Action; mode: "forgot" | "resend" }) {
  const t = useTranslations(`Common.accounts.${mode}`);
  const common = useTranslations("Common.auth");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const hydrated = useHydrated();

  // Same message whether or not the email has an account (no enumeration).
  if (state.status === "sent") return <Alert>{t("sent")}</Alert>;
  return (
    // key: re-mount after an error so the typed email comes back (see FormState.nonce).
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
      <FormError state={state} />
      <LocaleField />
      <TextField
        label={common("email")}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        defaultValue={state.values?.email}
        error={fieldError(state.fieldErrors?.email)}
      />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("submit")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ action, token, signInHref }: { action: Action; token: string; signInHref: string }) {
  const t = useTranslations("Common.accounts.reset");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const hydrated = useHydrated();

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>{t("done")}</Alert>
        <a href={signInHref} className="font-semibold underline underline-offset-4">
          {t("signIn")}
        </a>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <TextField
        label={t("newPassword")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        hint={t("hint", { min: MIN_PASSWORD_LENGTH })}
        error={fieldError(state.fieldErrors?.password, { min: MIN_PASSWORD_LENGTH })}
      />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("submit")}
      </Button>
    </form>
  );
}

export function ConfirmEmailForm({ action, token, signInHref }: { action: Action; token: string; signInHref: string }) {
  const t = useTranslations("Common.accounts.verify");
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const hydrated = useHydrated();

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>{t("done")}</Alert>
        <a href={signInHref} className="font-semibold underline underline-offset-4">
          {t("signIn")}
        </a>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError state={state} />
      <p>{t("intro")}</p>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("submit")}
      </Button>
    </form>
  );
}
