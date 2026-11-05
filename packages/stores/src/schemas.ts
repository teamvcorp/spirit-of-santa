/** Admin store-action inputs (Next-free, unit-testable). Error messages are codes for Common.formErrors. */
import { z } from "zod";
import { MAX_PRICE_CENTS, parseDollarsToCents } from "@repo/lib/format";
import { MAX_DISCOUNT_BPS, STORE_CATEGORIES } from "@repo/lib/store";

/**
 * Discount typed by an admin as a percentage ("20", "17.5") → integer basis points.
 * Up to 2 decimals; 0–90%.
 */
export const discountPercentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, "invalid")
  .transform((v) => Math.round(Number(v) * 100))
  .refine((bps) => bps >= 0 && bps <= MAX_DISCOUNT_BPS, "invalid");

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "invalid");

export const rejectReasonSchema = z.string().trim().min(3, "tooShort").max(500, "tooLong");
export const suspendReasonSchema = z.string().trim().min(3, "tooShort").max(500, "tooLong");

export const inviteStoreSchema = z.object({
  storeName: z.string().trim().min(2, "tooShort").max(120, "tooLong"),
  ownerEmail: z.string().trim().toLowerCase().max(254, "invalid").pipe(z.email("invalid")),
  category: z.enum(STORE_CATEGORIES, "required"),
  discount: discountPercentSchema,
});
export type InviteStoreInput = {
  storeName: string;
  ownerEmail: string;
  category: (typeof STORE_CATEGORIES)[number];
  discountBps: number;
};

/**
 * Item form. `price` is typed in dollars ("29.99") and parsed to integer cents WITHOUT float
 * maths. It's optional at this level: reps never send one; the service requires it from owners.
 */
export const MAX_INVENTORY = 9999;
export const itemSchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "tooLong"),
  description: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n"))
    .pipe(z.string().trim().max(1000, "tooLong"))
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  category: z
    .string()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.enum(STORE_CATEGORIES, "invalid").optional())
    .optional(),
  price: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const cents = parseDollarsToCents(v);
      if (cents == null || cents < 1 || cents > MAX_PRICE_CENTS) {
        ctx.addIssue({ code: "custom", message: "invalidPrice" });
        return z.NEVER;
      }
      return cents;
    }),
  inventory: z.coerce.number("invalid").int("invalid").min(0, "invalid").max(MAX_INVENTORY, "invalid"),
});
export type ItemInput = { name: string; description?: string; category?: (typeof STORE_CATEGORIES)[number]; priceCents?: number; inventory: number };
export function toItemInput(parsed: z.infer<typeof itemSchema>): ItemInput {
  const { price, ...rest } = parsed;
  return { ...rest, priceCents: price };
}