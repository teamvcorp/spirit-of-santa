"use client";
/**
 * Delivery address form. Every rule is enforced on the server (@repo/families/address); the
 * browser attributes (required, maxLength, pattern, autocomplete) only help the parent.
 * Keyed by nonce so it re-mounts with the echoed values after an error (React 19 form reset).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { US_STATES, type DeliveryAddress } from "@repo/lib/address";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { deleteAddressAction, saveAddressAction, type AddressFormState } from "./actions";

const IDLE: AddressFormState = { status: "idle" };

export function AddressForm({ saved }: { saved: DeliveryAddress | null }) {
  const t = useTranslations("Address");
  const [state, action, pending] = useActionState(saveAddressAction, IDLE);
  const hydrated = useHydrated();
  const v = state.values ?? saved ?? { name: "", line1: "", line2: "", city: "", state: "", zip: "" };
  const err = state.status === "error" && state.error ? (state.error === "invalid" && state.field ? t(`errors.field.${state.field}` as never) : t(`errors.${state.error}`)) : null;
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "saved" && <Alert>{t("saved")}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}
      <TextField label={t("name")} name="name" required maxLength={80} autoComplete="name" defaultValue={v.name} />
      <TextField label={t("line1")} name="line1" required maxLength={100} autoComplete="address-line1" defaultValue={v.line1} />
      <TextField label={t("line2")} name="line2" maxLength={100} autoComplete="address-line2" defaultValue={v.line2} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <TextField label={t("city")} name="city" required maxLength={60} autoComplete="address-level2" defaultValue={v.city} />
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t("state")}</span>
          <select name="state" required defaultValue={v.state} autoComplete="address-level1" className="rounded-lg border border-foreground/20 bg-background px-3 py-2">
            <option value="" />
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t("zip")} name="zip" required maxLength={10} inputMode="numeric" pattern="\d{5}(-\d{4})?" autoComplete="postal-code" defaultValue={v.zip} />
      </div>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("save")}
      </Button>
    </form>
  );
}

export function DeleteAddressForm() {
  const t = useTranslations("Address");
  const [state, action, pending] = useActionState(deleteAddressAction, IDLE);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.status === "deleted" && <Alert>{t("deleted")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}`)}</Alert>}
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("delete")}
      </Button>
    </form>
  );
}
