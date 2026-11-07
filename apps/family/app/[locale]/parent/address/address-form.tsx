"use client";
/**
 * Delivery address panel: the form (while a gift is on its way) + "Delete address". One component
 * so the feedback is always right: after a delete the form re-mounts empty and only "Address
 * deleted." shows. Every rule is enforced on the server (@repo/families/address); the browser
 * attributes (required, maxLength, pattern, autocomplete) only help the parent. Keyed by nonce so it
 * re-mounts with the echoed values after an error (React 19 resets forms after an action).
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
const EMPTY = { name: "", line1: "", line2: "", city: "", state: "", zip: "" };

export function AddressPanel({ needed, saved, unreadable }: { needed: boolean; saved: DeliveryAddress | null; unreadable: boolean }) {
  const t = useTranslations("Address");
  const [del, delAction, delPending] = useActionState(deleteAddressAction, IDLE);
  const hydrated = useHydrated();
  const deleted = del.status === "deleted";
  return (
    <div className="flex flex-col gap-6">
      {deleted && <Alert>{t("deleted")}</Alert>}
      {del.status === "error" && del.error && <Alert tone="error">{t(`errors.${del.error}`)}</Alert>}
      {unreadable && !deleted && <Alert tone="error">{t("unreadable")}</Alert>}
      {needed ? (
        // A delete re-mounts the form: its old "saved" message and values are gone.
        <SaveForm key={del.nonce ?? "initial"} saved={deleted ? null : saved} />
      ) : (
        <p className="text-muted" data-testid="not-needed">{t("notNeeded")}</p>
      )}
      {(saved || unreadable) && !deleted && (
        <form action={delAction} className="flex flex-col gap-2 border-t border-foreground/10 pt-4">
          <p className="text-sm text-muted">{t("deleteHelp")}</p>
          <Button type="submit" variant="secondary" pending={delPending} disabled={!hydrated} className="self-start">
            {t("delete")}
          </Button>
        </form>
      )}
    </div>
  );
}

function SaveForm({ saved }: { saved: DeliveryAddress | null }) {
  const t = useTranslations("Address");
  const [state, action, pending] = useActionState(saveAddressAction, IDLE);
  const hydrated = useHydrated();
  const v = state.values ?? saved ?? EMPTY;
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
