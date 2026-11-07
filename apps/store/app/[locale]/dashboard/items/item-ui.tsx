"use client";
/**
 * Item forms. Owners see and set prices; reps see the price read-only (their new items wait
 * for the owner). Every rule is re-checked on the server; the UI only explains it.
 */
import Image from "next/image";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { formatCents } from "@repo/lib/format";
import { STORE_CATEGORIES } from "@repo/lib/store";
import { IMAGE_ACCEPT_ATTR, MAX_IMAGE_BYTES } from "@repo/storage/image-rules";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import {
  archiveItemAction,
  createItemAction,
  inventoryAction,
  itemPhotoAction,
  removeItemPhotoAction,
  restoreItemAction,
  updateItemAction,
  type ItemFormState,
} from "./actions";

type Action = (prev: ItemFormState, fd: FormData) => Promise<ItemFormState>;
const INITIAL: ItemFormState = { status: "idle" };
const reporting = (action: Action, onDone: (r: ItemFormState) => void, onError?: () => void): Action => async (prev, fd) => {
  const r = await action(prev, fd);
  if (r.status === "done") onDone(r);
  else if (r.status === "error") onError?.();
  return r;
};

/**
 * role=status region that takes focus. Each message gets a new id, so saving twice in a row
 * re-announces and re-focuses (same text twice would otherwise be silent; review 2026-11-05).
 */
function useNotice() {
  const [notice, setState] = useState<{ text: string; id: number } | null>(null);
  const counter = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  const setNotice = (text: string | null) => setState(text ? { text, id: ++counter.current } : null);
  return {
    setNotice,
    region: (
      <div ref={ref} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert key={notice.id}>{notice.text}</Alert>}
      </div>
    ),
  };
}

import type { ItemFormValues } from "./item-values";

/** Create (no itemId) or edit an item. */
export function ItemForm({
  itemId,
  initial,
  isOwner,
  canEdit,
  priceCents,
}: {
  itemId?: string;
  initial: ItemFormValues;
  isOwner: boolean;
  canEdit: boolean;
  priceCents?: number;
}) {
  const t = useTranslations("Items");
  const cats = useTranslations("Common.storeCategories");
  const errorsT = useTranslations("Dashboard.errors");
  const reg = useTranslations("RegisterPage");
  const fieldError = useFieldError();
  const router = useRouter();
  const { region, setNotice } = useNotice();
  const [state, formAction, pending] = useActionState(
    reporting(itemId ? updateItemAction : createItemAction, (r) => {
      if (!itemId && r.itemId) router.replace(`/dashboard/items/${r.itemId}?created=1`);
      else setNotice(t("saved"));
    }, () => setNotice(null)),
    INITIAL,
  );
  const hydrated = useHydrated();
  const v = { ...initial, ...(state.values ?? {}) } as ItemFormValues;
  const err = (f: string) => fieldError(state.fieldErrors?.[f]);
  return (
    <div className="flex flex-col gap-3">
      {region}
      <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-4">
        {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
        {state.status === "error" && !state.error && <Alert tone="error">{reg("fixErrors")}</Alert>}
        {itemId && <input type="hidden" name="itemId" value={itemId} />}
        {/* The stock number as LOADED (not the echoed one): the server compare-and-sets on it. */}
        {itemId && <input type="hidden" name="inventoryWas" value={initial.inventory} />}
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          <TextField label={t("name")} name="name" required maxLength={120} defaultValue={v.name} error={err("name")} />
          <div className="flex flex-col gap-1">
            <label htmlFor="description" className="text-sm font-medium">
              {t("description")}
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              maxLength={1000}
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
          <div className="flex flex-col gap-1">
            <label htmlFor="category" className="text-sm font-medium">
              {t("category")}
            </label>
            <select id="category" name="category" defaultValue={v.category} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
              <option value="">{t("noCategory")}</option>
              {STORE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {cats(c)}
                </option>
              ))}
            </select>
          </div>
          {isOwner ? (
            <TextField
              label={t("price")}
              name="price"
              inputMode="decimal"
              required
              placeholder="29.99"
              hint={t("priceHint")}
              defaultValue={v.price}
              error={err("price")}
            />
          ) : (
            <p className="text-sm">
              <span className="font-medium">{t("price")}: </span>
              {priceCents != null ? formatCents(priceCents) : t("needsPrice")}
              <span className="block text-muted">{t("repPriceNote")}</span>
            </p>
          )}
          <TextField label={t("inventory")} name="inventory" type="number" inputMode="numeric" min={0} max={9999} required defaultValue={v.inventory} error={err("inventory")} />
          <Button type="submit" pending={pending} disabled={!hydrated || !canEdit} className="self-start">
            {itemId ? t("save") : t("add")}
          </Button>
        </fieldset>
      </form>
    </div>
  );
}

/**
 * Inline stock update (works outside the item window). Not re-keyed on success, so keyboard
 * focus stays on the button; the status text lives in an always-present live region.
 */
export function InventoryForm({ itemId, inventory, label }: { itemId: string; inventory: number; label: string }) {
  const t = useTranslations("Items");
  const errorsT = useTranslations("Dashboard.errors");
  const [state, formAction, pending] = useActionState(inventoryAction, INITIAL);
  const hydrated = useHydrated();
  const id = `inv-${itemId}`;
  const isError = state.status === "error";
  const message = state.status === "done" ? t("stockSaved") : isError ? (state.error ? errorsT(state.error as never) : t("stockInvalid")) : "";
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      {/* Compare-and-set: a gift may reserve a unit while this form is open (server says "stockChanged"). */}
      <input type="hidden" name="inventoryWas" value={inventory} />
      <label htmlFor={id} className="sr-only">
        {t("inventoryFor", { name: label })}
      </label>
      <input
        id={id}
        name="inventory"
        type="number"
        min={0}
        max={9999}
        defaultValue={inventory}
        aria-invalid={isError ? true : undefined}
        aria-describedby={`${id}-status`}
        className="min-h-9 w-20 rounded-lg border border-input bg-background px-2"
      />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} size="sm" aria-label={t("updateStockFor", { name: label })}>
        {t("updateStock")}
      </Button>
      <span id={`${id}-status`} role="status" aria-live="polite" className={`text-sm ${isError ? "text-danger" : ""}`}>
        {message}
      </span>
    </form>
  );
}
/** Item photo: set/replace or remove. Size checked in the browser first. */
export function ItemPhoto({ itemId, photo, canEdit, alt }: { itemId: string; photo?: { url: string }; canEdit: boolean; alt: string }) {
  const t = useTranslations("Items");
  const p = useTranslations("Profile");
  const errorsT = useTranslations("Dashboard.errors");
  const { region, setNotice } = useNotice();
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(reporting(itemPhotoAction, () => setNotice(photo ? t("photoReplaced") : p("photoAdded")), () => setNotice(null)), INITIAL);
  const [rmState, rmAction, rmPending] = useActionState(reporting(removeItemPhotoAction, () => setNotice(p("photoRemoved"))), INITIAL);
  const hydrated = useHydrated();
  // Action states are never reset, so remember which form ran LAST and show only its error;
  // otherwise an old upload error would sit next to a later "Photo removed" (review 2026-11-05).
  const [last, setLast] = useState<"upload" | "remove">("upload");
  function checkSize(e: FormEvent<HTMLFormElement>) {
    setLast("upload");
    const file = (e.currentTarget.elements.namedItem("photo") as HTMLInputElement | null)?.files?.[0];
    if (file && file.size > MAX_IMAGE_BYTES) {
      e.preventDefault();
      setClientError(errorsT("too_large"));
    } else setClientError(null);
  }
  const lastState = last === "upload" ? state : rmState;
  const error = clientError ?? (lastState.status === "error" && lastState.error ? errorsT(lastState.error as never) : null);
  return (
    <div className="flex flex-col gap-3">
      {region}
      {photo ? (
        <Image src={photo.url} alt={alt} width={480} height={360} className="aspect-[4/3] w-full max-w-sm rounded-lg object-cover" />
      ) : (
        <p className="text-sm text-muted">{t("noPhoto")}</p>
      )}
      {canEdit && (
        <>
          <form key={state.nonce ?? "initial"} action={formAction} onSubmit={checkSize} className="flex flex-col gap-2">
            <input type="hidden" name="itemId" value={itemId} />
            <label htmlFor="photo" className="text-sm font-medium">
              {photo ? t("replacePhoto") : t("addPhoto")}
            </label>
            <input id="photo" name="photo" type="file" accept={IMAGE_ACCEPT_ATTR} required aria-describedby={error ? "item-photo-hint item-photo-error" : "item-photo-hint"} aria-invalid={error ? true : undefined} className="text-sm" />
            <p id="item-photo-hint" className="text-sm text-muted">
              {p("photoHint", { mb: MAX_IMAGE_BYTES / 1024 / 1024 })}
            </p>
            {error && (
              <p id="item-photo-error" role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
              {p("upload")}
            </Button>
          </form>
          {photo && (
            <form
              action={rmAction}
              onSubmit={() => {
                setLast("remove");
                setClientError(null);
              }}
            >
              <input type="hidden" name="itemId" value={itemId} />
              <Button type="submit" variant="ghost" pending={rmPending} disabled={!hydrated} size="inline">
                {p("removePhoto")}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/** Owner-only archive / restore. */
export function ArchiveButton({ itemId, archived, name }: { itemId: string; archived: boolean; name: string }) {
  const t = useTranslations("Items");
  const errorsT = useTranslations("Dashboard.errors");
  const { region, setNotice } = useNotice();
  const [state, formAction, pending] = useActionState(
    reporting(archived ? restoreItemAction : archiveItemAction, () => setNotice(archived ? t("restored") : t("archived"))),
    INITIAL,
  );
  const hydrated = useHydrated();
  return (
    <div className="flex flex-col gap-2">
      {region}
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!archived && !window.confirm(t("confirmArchive", { name }))) e.preventDefault();
        }}
      >
        <input type="hidden" name="itemId" value={itemId} />
        <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated}>
          {archived ? t("restore") : t("archive")}
        </Button>
      </form>
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
    </div>
  );
}