"use client";
/**
 * Admin item moderation on the store detail page (owner 2026-11-07: "hide item"). One small form per item:
 * an ACTIVE item gets a reason field + "Hide from families"; a HIDDEN one shows the reason + "Show again".
 * The Server Actions re-check the admin role and the item's status (compare-and-set), so this UI is a
 * convenience only. The reason is shown to the store, so write it for them.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { hideItemAction, unhideItemAction } from "../actions";
import { INITIAL_ADMIN_STATE } from "../admin-form-state";

type Row = { id: string; name: string; priceCents?: number; status: "draft" | "active" | "hidden"; hiddenReason?: string };

function ItemRowForm({ item }: { item: Row }) {
  const t = useTranslations("StoreAdmin.itemModeration");
  const errorsT = useTranslations("StoreAdmin.errors");
  const fieldError = useFieldError();
  const hidden = item.status === "hidden";
  const [state, action, pending] = useActionState(hidden ? unhideItemAction : hideItemAction, INITIAL_ADMIN_STATE);
  const hydrated = useHydrated();
  const reasonError = fieldError(state.fieldErrors?.reason);
  return (
    <li className="flex flex-col gap-2 py-3" data-item-status={item.status}>
      <p>
        <span className="font-semibold">{item.name}</span>
        {item.priceCents != null && <span className="text-muted"> · {formatCents(item.priceCents)}</span>}
        <span className="ml-2 rounded-full border border-foreground/30 px-2 text-xs">{t(`status.${item.status}`)}</span>
      </p>
      {hidden && item.hiddenReason && <p className="text-sm text-muted">{t("reasonShown", { reason: item.hiddenReason })}</p>}
      {item.status !== "draft" && (
        <form key={state.nonce ?? "initial"} action={action} className="flex flex-wrap items-end gap-2">
          {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
          <input type="hidden" name="itemId" value={item.id} />
          {!hidden && (
            <div className="min-w-0 flex-1">
              <TextField label={t("reason")} name="reason" required minLength={3} maxLength={500} defaultValue={state.values?.reason ?? ""} error={reasonError} />
            </div>
          )}
          <Button type="submit" variant={hidden ? "primary" : "secondary"} pending={pending} disabled={!hydrated}>
            {hidden ? t("show") : t("hide")}
          </Button>
        </form>
      )}
    </li>
  );
}

export function ItemModeration({ items }: { items: Row[] }) {
  const t = useTranslations("StoreAdmin.itemModeration");
  if (items.length === 0) return <p className="text-sm text-muted">{t("none")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-foreground/10" data-testid="admin-items">
      {items.map((i) => (
        // Keyed by status too: after hide/show the row remounts with the other action (fresh form state).
        <ItemRowForm key={`${i.id}-${i.status}`} item={i} />
      ))}
    </ul>
  );
}
