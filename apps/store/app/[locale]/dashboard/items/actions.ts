"use server";
/**
 * Item Server Actions (owner or rep). Each: requireRole → validate → @repo/stores/items
 * (re-checks membership, store status, season window, limit, owner-only pricing) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@repo/auth";
import { fieldErrors } from "@repo/auth/schemas";
import { archiveItem, createItem, removeItemPhoto, restoreItem, setInventory, setItemPhoto, updateItem, type ItemResult } from "@repo/stores/items";
import { inventoryFormSchema, inventorySchema, itemSchema, objectIdSchema, toItemInput } from "@repo/stores/schemas";
import { authOptions } from "@/auth";
import type { DashFormState } from "../form-state";

/** inventoryNow = the current stock after a "stockChanged" refusal: the form compares against it next time. */
export type ItemFormState = DashFormState & { itemId?: string; inventoryNow?: number };

async function member() {
  const u = await requireRole(authOptions, "store_owner", "store_rep");
  return { id: u.id, role: u.role, storeId: u.storeId };
}
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const result = (r: ItemResult, values?: Record<string, string>): ItemFormState => {
  if (!r.ok) return { status: "error", error: r.error, values, nonce: randomUUID(), ...(r.inventoryNow != null ? { inventoryNow: r.inventoryNow } : {}) };
  refresh();
  return { status: "done", itemId: r.itemId, nonce: randomUUID() };
};
/**
 * Full submitted strings for VALIDATION (zod caps lengths; truncating first would silently
 * drop text, e.g. CRLF line breaks count double; review 2026-11-05), and a capped copy to echo back.
 */
function formValues(fd: FormData) {
  const full: Record<string, string> = {};
  for (const [k, val] of fd) if (typeof val === "string" && !k.startsWith("$")) full[k] = val;
  const echo = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.slice(0, 2000)]));
  return { full, echo };
}
/** The stock number the form SHOWED (hidden field): the service compare-and-sets on it. null = missing/forged. */
function inventoryWasOf(fd: FormData): number | null {
  const was = inventorySchema.safeParse(str(fd, "inventoryWas"));
  return was.success ? was.data : null;
}
function idOf(fd: FormData) {
  const id = objectIdSchema.safeParse(str(fd, "itemId"));
  return id.success ? id.data : null;
}

export async function createItemAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const { full, echo } = formValues(fd);
  const parsed = itemSchema.safeParse(full);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values: echo, nonce: randomUUID() };
  return result(await createItem(actor, toItemInput(parsed.data)), echo);
}

export async function updateItemAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  if (!id) return { status: "error", error: "notFound", nonce: randomUUID() };
  const { full, echo } = formValues(fd);
  const parsed = itemSchema.safeParse(full);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values: echo, nonce: randomUUID() };
  const was = inventoryWasOf(fd);
  if (was === null) return { status: "error", error: "stockChanged", values: echo, nonce: randomUUID() };
  return result(await updateItem(actor, id, toItemInput(parsed.data), was), echo);
}

export async function inventoryAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  if (!id) return { status: "error", error: "notFound", nonce: randomUUID() };
  // Zod like every other form: an empty box is an error, never "0 in stock".
  const parsed = inventoryFormSchema.safeParse({ inventory: str(fd, "inventory") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), nonce: randomUUID() };
  const was = inventoryWasOf(fd);
  if (was === null) return { status: "error", error: "stockChanged", nonce: randomUUID() };
  return result(await setInventory(actor, id, parsed.data.inventory, was));
}

export async function archiveItemAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  return id ? result(await archiveItem(actor, id)) : { status: "error", error: "notFound", nonce: randomUUID() };
}

export async function restoreItemAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  return id ? result(await restoreItem(actor, id)) : { status: "error", error: "notFound", nonce: randomUUID() };
}

export async function itemPhotoAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  const file = fd.get("photo");
  if (!id) return { status: "error", error: "notFound", nonce: randomUUID() };
  if (!(file instanceof Blob) || file.size === 0) return { status: "error", error: "empty", nonce: randomUUID() };
  return result(await setItemPhoto(actor, id, file));
}

export async function removeItemPhotoAction(_prev: ItemFormState, fd: FormData): Promise<ItemFormState> {
  const actor = await member();
  const id = idOf(fd);
  return id ? result(await removeItemPhoto(actor, id)) : { status: "error", error: "notFound", nonce: randomUUID() };
}