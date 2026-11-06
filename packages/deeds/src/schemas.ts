/**
 * Deed catalog form validation (admin /deeds). CLIENT-SAFE (zod only).
 * Tip amounts are typed in dollars ("5" / "12.50") and stored as integer cents, parsed without
 * float maths (parseDollarsToCents in @repo/lib/format).
 */
import { z } from "zod";
import { parseDollarsToCents } from "@repo/lib/format";
import { MAX_TIP_CENTS } from "@repo/lib/limits";

const text = (max: number) => z.string().trim().max(max, "tooLong");
/** "" → undefined; otherwise dollars → cents (1¢ … MAX_TIP_CENTS). */
const dollars = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const cents = parseDollarsToCents(v);
    if (cents == null || cents < 1 || cents > MAX_TIP_CENTS) {
      ctx.addIssue({ code: "custom", message: "invalidAmount" });
      return z.NEVER;
    }
    return cents;
  });

export const deedTypeSchema = z
  .object({
    titleEn: text(100).min(1, "required"),
    // Spanish is a launch requirement, so it's required here (the model allows it missing).
    titleEs: text(100).min(1, "required"),
    descriptionEn: text(200),
    descriptionEs: text(200),
    tipMin: dollars,
    tipMax: dollars,
  })
  .superRefine((v, ctx) => {
    if (v.tipMin != null && v.tipMax != null && v.tipMin > v.tipMax) ctx.addIssue({ code: "custom", path: ["tipMax"], message: "minAboveMax" });
  });

export type DeedTypeInput = z.infer<typeof deedTypeSchema>;

/**
 * Recording a deed (family app, parent with PIN). Exactly one of: a catalog deed type, or
 * "other" with a short description (max 280, the model's limit).
 */
/** The "Other" description on its own, so a form gets the PRECISE error (tooShort / tooLong). */
export const otherDeedSchema = z.string().trim().min(3, "tooShort").max(280, "tooLong");
export const recordDeedSchema = z.union([
  z.object({ choice: z.string().regex(/^[0-9a-f]{24}$/i, "invalid").transform((v) => v.toLowerCase()), other: z.string().optional() }),
  z.object({ choice: z.literal("other"), other: otherDeedSchema }),
]);
