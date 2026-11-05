"use client";
/**
 * Store sign-up form. All rules are enforced again on the server
 * (storeRegistrationSchema + registerStoreOwner); HTML attributes here only give quick hints.
 *
 * - Submit is disabled until JavaScript is ready (see @repo/ui/use-hydrated for why).
 * - After an error the server echoes back what was typed (never the password).
 * - "company_url" is a honeypot: hidden from people and screen readers, bots fill it in.
 */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { INITIAL_FORM_STATE, type FormState } from "@repo/auth/form-state";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@repo/auth/schemas";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { AgreementFields } from "../_components/agreement-fields";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function RegisterForm({ action }: { action: Action }) {
  const t = useTranslations("RegisterPage");
  const cats = useTranslations("Common.storeCategories");
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

  return (
    // key: re-mount after each failed submit so every field (incl. the select and checkbox)
    // starts from the echoed values. See FormState.nonce.
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error)}</Alert>}
      {state.status === "error" && state.fieldErrors && !state.error && <Alert tone="error">{t("fixErrors")}</Alert>}
      <input type="hidden" name="locale" value={locale} />

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t("you")}</legend>
        <TextField label={t("ownerName")} name="ownerName" autoComplete="name" required maxLength={100} defaultValue={v.ownerName} error={err("ownerName")} />
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
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t("store")}</legend>
        <TextField label={t("storeName")} name="storeName" autoComplete="organization" required minLength={2} maxLength={120} defaultValue={v.storeName} error={err("storeName")} />
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-medium">
            {t("category")}
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue={v.category ?? ""}
            aria-invalid={state.fieldErrors?.category ? true : undefined}
            aria-describedby={state.fieldErrors?.category ? "category-error" : undefined}
            className={`min-h-11 rounded-lg border bg-background px-3 py-2 ${state.fieldErrors?.category ? "border-danger" : "border-input"}`}
          >
            <option value="" disabled>
              {t("categoryPlaceholder")}
            </option>
            {STORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {cats(c)}
              </option>
            ))}
          </select>
          {state.fieldErrors?.category && (
            <p id="category-error" className="text-sm text-danger">
              {err("category")}
            </p>
          )}
        </div>
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
          <p id="description-hint" className="text-sm text-foreground/70">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <TextField label={t("city")} name="city" autoComplete="address-level2" required maxLength={60} defaultValue={v.city} error={err("city")} />
          <TextField label={t("state")} name="state" autoComplete="address-level1" required maxLength={2} defaultValue={v.state} error={err("state")} />
          <TextField label={t("zip")} name="zip" autoComplete="postal-code" inputMode="numeric" required pattern="\d{5}" maxLength={5} defaultValue={v.zip} error={err("zip")} />
        </div>
      </fieldset>

      <AgreementFields defaultChecked={v.agree === "on"} error={err("agree")} />

      {/* Honeypot (see header). Off-screen rather than display:none, which some bots skip. */}
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
