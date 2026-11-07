"use server";
/**
 * Save / delete the family's delivery address (parent + PIN unlock re-checked here: an action is a
 * public POST endpoint). Validation + encryption + "only while a gift is on its way" live in
 * @repo/families/address (the ONE place for the rules).
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { deleteAddress, saveAddress } from "@repo/families/address";
import { DELIVERY_ADDRESS_FIELDS } from "@repo/lib/address";
import { unlockedParentOrNull } from "@/lib/parent";

export type AddressFormState = {
  status: "idle" | "saved" | "deleted" | "error";
  error?: "locked" | "notFound" | "notNeeded" | "invalid";
  field?: string;
  /** Echo of what was typed (React 19 resets forms after an action). */
  values?: Record<string, string>;
  nonce?: string;
};

export async function saveAddressAction(_prev: AddressFormState, fd: FormData): Promise<AddressFormState> {
  // Capped echo copies; the service's Zod schema is the real check.
  const values = Object.fromEntries(DELIVERY_ADDRESS_FIELDS.map((k) => [k, typeof fd.get(k) === "string" ? String(fd.get(k)).slice(0, 120) : ""]));
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked", values, nonce: randomUUID() };
  const r = await saveAddress(parent, values);
  if (!r.ok) return { status: "error", error: r.error, field: r.field, values, nonce: randomUUID() };
  refresh();
  return { status: "saved", nonce: randomUUID() };
}

export async function deleteAddressAction(): Promise<AddressFormState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { status: "error", error: "locked", nonce: randomUUID() };
  const r = await deleteAddress(parent);
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "deleted", nonce: randomUUID() };
}
