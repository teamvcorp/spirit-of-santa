"use client";
/** A rep accepts a store owner's invite: name + password. */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { INITIAL_FORM_STATE, type FormState } from "@repo/auth/form-state";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@repo/auth/schemas";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function RepInviteForm({ action, token, email, signInHref }: { action: Action; token: string; email: string; signInHref: string }) {
  const t = useTranslations("AcceptRepInvitePage");
  const errorsT = useTranslations("Common.accounts.errors");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const locale = useLocale();
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
  const err = (f: string) => fieldError(state.fieldErrors?.[f], { min: MIN_PASSWORD_LENGTH });
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error)}</Alert>}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <TextField label={t("email")} name="username" value={email} readOnly autoComplete="username" />
      <TextField label={t("name")} name="name" autoComplete="name" required maxLength={100} defaultValue={state.values?.name} error={err("name")} />
      <TextField
        label={t("password")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
        error={err("password")}
      />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}