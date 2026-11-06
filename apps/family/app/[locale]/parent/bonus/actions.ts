"use server";
/**
 * Start a bonus (parent + PIN unlock re-checked here: an action is a public POST endpoint).
 * Zod-validated; the amount is re-checked by tipAmountCents and again by the webhook.
 */
import { z } from "zod";
import { startBonus, type BonusStart } from "@repo/families/bonus";
import { tipAmountCents } from "@repo/deeds/public";
import { localizePath } from "@repo/i18n/paths";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import { unlockedParentOrNull } from "@/lib/parent";
import { echoAmount, formFields, type AmountEcho } from "../../../../lib/amount-form";

/** `kid` is echoed with the amount so the form remounts with the same child picked. */
export type BonusState = ({ status: "idle" } | BonusStart | { ok: false; error: "locked" | "invalid" }) & AmountEcho & { kid?: string };

const schema = z.object({
  kid: z.string().regex(OBJECT_ID_RE),
  amount: z.string().max(10),
  other: z.string().max(10).optional().default(""),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});

export async function bonusAction(_prev: BonusState, fd: FormData): Promise<BonusState> {
  const kidRaw = fd.get("kid");
  const echo = { ...echoAmount(fd), kid: typeof kidRaw === "string" ? kidRaw.slice(0, 24) : undefined };
  const parent = await unlockedParentOrNull();
  if (!parent) return { ok: false, error: "locked", ...echo };
  const parsed = schema.safeParse(formFields(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some((i) => i.path[0] === "kid") ? "notFound" : "invalid", ...echo };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const { kid, amount, other, locale } = parsed.data;
  return { ...(await startBonus(parent, kid, tipAmountCents(amount, other), origin, (p) => localizePath(p, locale))), ...echo };
}
