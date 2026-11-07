/**
 * Family DELIVERY address (Phase 6 slice 4b): where Spirit O Santa sends funded gifts.
 * Client-safe (the form uses the same rules); the SERVER re-validates with this schema and stores
 * it ENCRYPTED (@repo/auth/sealed, ADDRESS_ENCRYPTION_KEY). US addresses only for now.
 */
import { z } from "zod";

/** 50 states + DC + territories USPS delivers to. */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
] as const;

// No control or invisible FORMAT characters (e.g. right-to-left overrides, zero-width), no angle
// brackets: it ends up on shipping labels and admin pages and must read exactly as typed.
const text = (min: number, max: number) =>
  z.string().trim().min(min).max(max).regex(/^[^<>\p{Cc}\p{Cf}]*$/u, "invalid");

export const deliveryAddressSchema = z.object({
  name: text(2, 80), // who the package is addressed to
  line1: text(3, 100),
  // Optional: blank or only spaces = no second line.
  line2: z.string().trim().pipe(z.union([z.literal(""), text(1, 100)])),
  city: text(2, 60),
  state: z.string().trim().toUpperCase().pipe(z.enum(US_STATES)),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "invalid"),
});
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
export const DELIVERY_ADDRESS_FIELDS = ["name", "line1", "line2", "city", "state", "zip"] as const;

/** Label lines ("Jane Doe" / "1 Main St" / "Apt 2" / "Austin, TX 78701"). */
export function addressLines(a: DeliveryAddress): string[] {
  return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean);
}
