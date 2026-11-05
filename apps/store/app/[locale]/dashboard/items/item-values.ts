/**
 * Form defaults for an item. Plain module (no "use client"), so server pages can call it and
 * pass the result to the client form. (Calling a function exported from a "use client" file
 * on the server throws; found by the browser E2E.)
 */
import { centsToInput } from "@repo/lib/format";

export type ItemFormValues = { name: string; description: string; category: string; price: string; inventory: string };

export function initialValues(item?: { name: string; description?: string; category?: string; priceCents?: number; inventory: number }): ItemFormValues {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "",
    price: item?.priceCents != null ? centsToInput(item.priceCents) : "",
    inventory: String(item?.inventory ?? 0),
  };
}