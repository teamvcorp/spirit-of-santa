"use client";
/** Owner edits store details. Same rules as sign-up (storeDetailsSchema), re-checked on the server. */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { saveProfileAction } from "../actions";
import { INITIAL_DASH_STATE } from "../form-state";

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
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-medium">
            {reg("category")}
          </label>
          <select id="category" name="category" required defaultValue={v.category} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
            {STORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {cats(c)}
              </option>
            ))}
          </select>
        </div>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <TextField label={reg("city")} name="city" required maxLength={60} defaultValue={v.city} error={err("city")} />
          <TextField label={reg("state")} name="state" required maxLength={2} defaultValue={v.state} error={err("state")} />
          <TextField label={reg("zip")} name="zip" inputMode="numeric" required pattern="\d{5}" maxLength={5} defaultValue={v.zip} error={err("zip")} />
        </div>
        <Button type="submit" pending={pending} disabled={!hydrated || !editable}>
          {t("save")}
        </Button>
      </fieldset>
    </form>
  );
}