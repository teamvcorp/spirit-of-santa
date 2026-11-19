"use client";
/**
 * Store sign-up STEP 2 (email first, owner 2026-11-19): opened from the emailed "Register your store" link.
 * The email is NOT a field: it comes from the link (already proven) and is only shown. All rules are enforced
 * again on the server (storeSignupCompleteSchema + completeStoreSignup); HTML attributes only give quick hints.
 *
 * - Submit is disabled until JavaScript is ready (see @repo/ui/use-hydrated for why).
 * - After an error the server echoes back what was typed (never the password or the link token).
 * - Bots are stopped at step 1 (honeypot + limits there): nothing reaches this form without a real inbox.
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { INITIAL_FORM_STATE, type FormState } from "@repo/auth/form-state";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@repo/auth/schemas";
import { US_STATES } from "@repo/lib/address";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AgreementFields } from "../_components/agreement-fields";
import { CITY_STATE_ZIP_ROW } from "@repo/ui/layout";
import { Link } from "@/i18n/navigation";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function RegisterForm({ action, token, email }: { action: Action; token: string; email: string }) {
  const t = useTranslations("RegisterPage");
  const cats = useTranslations("Common.storeCategories");
  const errorsT = useTranslations("Common.accounts.errors");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const locale = useLocale();
  const hydrated = useHydrated();

  if (state.status === "done") {
    return (
      <Alert>
        <strong className="block">{t("doneTitle")}</strong>
        {t("doneBody")}{" "}
        <Link href="/signin" className="font-semibold underline underline-offset-4">
          {t("signIn")}
        </Link>
      </Alert>
    );
  }

  const v = state.values ?? {};
  const err = (field: string) => fieldError(state.fieldErrors?.[field], { min: MIN_PASSWORD_LENGTH });

  return (
    // key: re-mount after each failed submit so every field (incl. the select and checkbox)
    // starts from the echoed values. See FormState.nonce.
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error)}</Alert>}
      {state.status === "error" && state.fieldErrors && !state.error && <Alert tone="error">{t("fixErrors")}</Alert>}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t("you")}</legend>
        <p className="text-sm" data-testid="signup-email">
          {t("signingUpAs", { email })}
        </p>
        <TextField label={t("ownerName")} name="ownerName" autoComplete="name" required maxLength={100} defaultValue={v.ownerName} error={err("ownerName")} />
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
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t("store")}</legend>
        <TextField label={t("storeName")} name="storeName" autoComplete="organization" required minLength={2} maxLength={120} defaultValue={v.storeName} error={err("storeName")} />
        <SelectField id="category" label={t("category")} name="category" required defaultValue={v.category ?? ""} error={err("category")}>
          <option value="" disabled>
            {t("categoryPlaceholder")}
          </option>
          {STORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {cats(c)}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium">
            {t("description")}
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={v.description}
            aria-invalid={state.fieldErrors?.description ? true : undefined}
            aria-describedby={state.fieldErrors?.description ? "description-hint description-error" : "description-hint"}
            className={`rounded-lg border bg-background px-3 py-2 ${state.fieldErrors?.description ? "border-danger" : "border-input"}`}
          />
          <p id="description-hint" className="text-sm text-muted">
            {t("descriptionHint")}
          </p>
          {state.fieldErrors?.description && (
            <p id="description-error" className="text-sm text-danger">
              {err("description")}
            </p>
          )}
        </div>
        <TextField label={t("phone")} name="phone" type="tel" autoComplete="tel" maxLength={30} defaultValue={v.phone} error={err("phone")} />
        <TextField label={t("website")} name="website" type="url" autoComplete="url" placeholder="https://" maxLength={300} defaultValue={v.website} error={err("website")} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t("address")}</legend>
        <TextField label={t("line1")} name="line1" autoComplete="address-line1" required maxLength={120} defaultValue={v.line1} error={err("line1")} />
        <div className={CITY_STATE_ZIP_ROW}>
          <TextField label={t("city")} name="city" autoComplete="address-level2" required maxLength={60} defaultValue={v.city} error={err("city")} />
          <SelectField label={t("state")} name="state" autoComplete="address-level1" required defaultValue={v.state ?? ""} error={err("state")}>
            <option value="" />
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <TextField label={t("zip")} name="zip" autoComplete="postal-code" inputMode="numeric" required pattern="\d{5}" maxLength={5} defaultValue={v.zip} error={err("zip")} />
        </div>
      </fieldset>

      <AgreementFields defaultChecked={v.agree === "on"} error={err("agree")} />

      <Button type="submit" pending={pending} disabled={!hydrated}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
