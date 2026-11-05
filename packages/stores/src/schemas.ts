/** Admin store-action inputs (Next-free, unit-testable). Error messages are codes for Common.formErrors. */
import { z } from "zod";
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
