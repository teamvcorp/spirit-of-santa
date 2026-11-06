"use server";
/**
 * Start a child registration (parent + PIN unlock re-checked here). The browser only says WHICH
 * of the family's awaiting kids; the amount is decided on the server (@repo/families/registration).
 */
import { formString } from "@repo/lib/form";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { startRegistration, type StartResult } from "@repo/families/registration";
import { unlockedParentOrNull } from "@/lib/parent";

export type RegisterState = { status: "idle" } | StartResult | { kind: "error"; error: "locked" };

export async function startRegistrationAction(_prev: RegisterState, fd: FormData): Promise<RegisterState> {
  const parent = await unlockedParentOrNull();
  if (!parent) return { kind: "error", error: "locked" };
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL is not set");
  const raw = fd.get("locale");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const kidIds = fd.getAll("kid").filter((v): v is string => typeof v === "string").slice(0, 20);
  return startRegistration(parent, kidIds, formString(fd, "promo").slice(0, 40), origin, (p) => localizePath(p, locale));
}
