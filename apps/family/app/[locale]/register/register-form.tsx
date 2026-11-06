"use client";
/**
 * Parent sign-up form. Every rule is enforced again on the server (parentRegistrationSchema +
 * registerParent); attributes here are only quick hints.
 * - Submit disabled until JavaScript is ready (@repo/ui/use-hydrated).
 * - After an error the server echoes back what was typed (never the password).
 * - "company_url" is a honeypot: hidden from people and screen readers, bots fill it in.
 * - The consent box links to the Children's Privacy Notice (/privacy, DRAFT until legal review).
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { INITIAL_FORM_STATE, type FormState } from "@repo/auth/form-state";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@repo/auth/schemas";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function ParentRegisterForm({ action }: { action: Action }) {
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
  const v = state.values ?? {};
  const err = (field: string) => fieldError(state.fieldErrors?.[field], { min: MIN_PASSWORD_LENGTH });
  const consentErr = state.fieldErrors?.consent;
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-5">
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error)}</Alert>}
      {state.status === "error" && state.fieldErrors && !state.error && <Alert tone="error">{t("fixErrors")}</Alert>}
      <input type="hidden" name="locale" value={locale} />
      <TextField label={t("parentName")} name="parentName" autoComplete="name" required maxLength={100} defaultValue={v.parentName} error={err("parentName")} />
      <TextField label={t("email")} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} defaultValue={v.email} error={err("email")} />
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
      <TextField label={t("familyName")} hint={t("familyNameHint")} name="familyName" autoComplete="family-name" required maxLength={80} defaultValue={v.familyName} error={err("familyName")} />
      <TextField label={t("zip")} hint={t("zipHint")} name="zip" autoComplete="postal-code" inputMode="numeric" pattern="\d{5}" maxLength={5} defaultValue={v.zip} error={err("zip")} />

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            required
            defaultChecked={v.consent === "on"}
            aria-invalid={consentErr ? true : undefined}
            aria-describedby={consentErr ? "consent-error" : undefined}
            className="mt-1 size-5 shrink-0"
          />
          <span className="text-sm">
            {t.rich("consent", {
              notice: (chunks) => (
                <Link href="/privacy" className="font-semibold underline underline-offset-4" target="_blank">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {consentErr && (
          <p id="consent-error" className="text-sm text-danger">
            {err("consent")}
          </p>
        )}
      </div>

      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company URL
          <input type="text" name="company_url" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <Button type="submit" pending={pending} disabled={!hydrated}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
