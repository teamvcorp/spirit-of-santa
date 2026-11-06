"use server";
/**
 * Record a deed (parent + PIN unlock re-checked here) → @repo/deeds/deeds (kid ownership,
 * registration, season, active deed type, daily cap) → back to the kid's page with the new QR.
 */
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { recordDeed } from "@repo/deeds/deeds";
import { otherDeedSchema, recordDeedSchema } from "@repo/deeds/schemas";
import { localizePath } from "@repo/i18n/paths";
import { formString } from "@repo/lib/form";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { unlockedParentOrNull } from "@/lib/parent";

export type DeedFormState = { status: "idle" | "error"; error?: string; fieldError?: string; values?: Record<string, string>; nonce?: string };

export async function recordDeedAction(_prev: DeedFormState, fd: FormData): Promise<DeedFormState> {
  const values = { choice: formString(fd, "choice").slice(0, 40), other: formString(fd, "other").slice(0, 400) };
  const fail = (e: Partial<DeedFormState>): DeedFormState => ({ status: "error", values, nonce: randomUUID(), ...e });
  const parent = await unlockedParentOrNull();
  if (!parent) return fail({ error: "locked" });
  // "Other": check the text on its own first, so the parent sees "too short"/"too long" (a union
  // of both shapes would only say "invalid input").
  if (values.choice === "other") {
    const text = otherDeedSchema.safeParse(values.other);
    if (!text.success) return fail({ fieldError: text.error.issues[0]?.message ?? "invalid" });
  }
  const parsed = recordDeedSchema.safeParse(values);
  if (!parsed.success) return fail({ error: "pickOne" });
  const raw = fd.get("locale");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const kidId = formString(fd, "kidId");
  const input = parsed.data.choice === "other" ? { other: (parsed.data as { other: string }).other } : { deedTypeId: parsed.data.choice };
  const r = await recordDeed(parent, kidId, input, locale);
  if (!r.ok) return fail({ error: r.error });
  redirect(localizePath(`/kids/${encodeURIComponent(kidId)}`, locale));
}
