"use client";
/** Owner edits store details. Same rules as sign-up (storeDetailsSchema), re-checked on the server. */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { US_STATES } from "@repo/lib/address";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { saveProfileAction } from "../actions";
import { INITIAL_DASH_STATE } from "../form-state";
import { CITY_STATE_ZIP_ROW } from "@repo/ui/layout";

export type ProfileValues = {
  storeName: string;
  category: string;
  description: string;
  phone: string;
  website: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
};

export function ProfileForm({ initial, editable }: { initial: ProfileValues; editable: boolean }) {
  const t = useTranslations("Profile");
  const reg = useTranslations("RegisterPage");
  const cats = useTranslations("Common.storeCategories");
  const errorsT = useTranslations("Dashboard.errors");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(saveProfileAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  const v = { ...initial, ...(state.values ?? {}) } as ProfileValues;
  const err = (f: string) => fieldError(state.fieldErrors?.[f]);

  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
      {state.status === "done" && <Alert>{t("saved")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
      {state.status === "error" && !state.error && <Alert tone="error">{reg("fixErrors")}</Alert>}
      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <TextField label={reg("storeName")} name="storeName" required minLength={2} maxLength={120} defaultValue={v.storeName} error={err("storeName")} />
        <SelectField id="category" label={reg("category")} name="category" required defaultValue={v.category} error={err("category")}>
          {STORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {cats(c)}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium">
            {reg("description")}
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={v.description}
            aria-invalid={state.fieldErrors?.description ? true : undefined}
            aria-describedby={state.fieldErrors?.description ? "description-error" : undefined}
            className="rounded-lg border border-input bg-background px-3 py-2"
          />
          {err("description") && (
            <p id="description-error" className="text-sm text-danger">
              {err("description")}
            </p>
          )}
        </div>
        <TextField label={reg("phone")} name="phone" type="tel" maxLength={30} defaultValue={v.phone} error={err("phone")} />
        <TextField label={reg("website")} name="website" type="url" placeholder="https://" maxLength={300} defaultValue={v.website} error={err("website")} />
        <TextField label={reg("line1")} name="line1" required maxLength={120} defaultValue={v.line1} error={err("line1")} />
        <div className={CITY_STATE_ZIP_ROW}>
          <TextField label={reg("city")} name="city" required maxLength={60} defaultValue={v.city} error={err("city")} />
          {/* A list, not free text: only real US states (the server checks the same list, @repo/lib/address). */}
          <SelectField label={reg("state")} name="state" autoComplete="address-level1" required defaultValue={v.state} error={err("state")}>
            <option value="" />
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <TextField label={reg("zip")} name="zip" inputMode="numeric" required pattern="\d{5}" maxLength={5} defaultValue={v.zip} error={err("zip")} />
        </div>
        <Button type="submit" pending={pending} disabled={!hydrated || !editable}>
          {t("save")}
        </Button>
      </fieldset>
    </form>
  );
}