"use client";
/** Admin invites a store directly: store name, owner email, category, agreed discount, email language. */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { inviteAction } from "../actions";
import { INITIAL_ADMIN_STATE } from "../admin-form-state";

export function InviteForm() {
  const t = useTranslations("StoreAdmin");
  const cats = useTranslations("Common.storeCategories");
  const fieldError = useFieldError();
  const [state, formAction, pending] = useActionState(inviteAction, INITIAL_ADMIN_STATE);
  const hydrated = useHydrated();

  if (state.status === "done" && state.storeId) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>{t("inviteSent")}</Alert>
        <Link href={`/stores/${state.storeId}`} className="font-semibold underline underline-offset-4">
          {t("viewStore")}
        </Link>
      </div>
    );
  }
  const v = state.values ?? {};
  const err = (f: string) => fieldError(state.fieldErrors?.[f]);
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <TextField label={t("storeName")} name="storeName" required minLength={2} maxLength={120} defaultValue={v.storeName} error={err("storeName")} />
      <TextField label={t("ownerEmail")} name="ownerEmail" type="email" required maxLength={254} defaultValue={v.ownerEmail} error={err("ownerEmail")} />
      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="text-sm font-medium">
          {t("category")}
        </label>
        <select id="category" name="category" required defaultValue={v.category ?? ""} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
          <option value="" disabled>
            {t("categoryPlaceholder")}
          </option>
          {STORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {cats(c)}
            </option>
          ))}
        </select>
        {err("category") && <p className="text-sm text-danger">{err("category")}</p>}
      </div>
      <TextField
        label={t("discountLabel")}
        name="discount"
        inputMode="decimal"
        required
        pattern="\d{1,2}(\.\d{1,2})?"
        hint={t("discountHint")}
        defaultValue={v.discount}
        error={err("discount")}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="language" className="text-sm font-medium">
          {t("language")}
        </label>
        <select id="language" name="language" defaultValue={v.language ?? "en"} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("sendInvite")}
      </Button>
    </form>
  );
}