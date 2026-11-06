"use server";
/**
 * Admin season actions. Each: requireRole admin (a Server Action is a public POST endpoint) →
 * zod → @repo/stores/season (rules re-checked there, audited) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { setForceFrozen, setSeasonDates, setStoreWindow, type SeasonResult } from "@repo/stores/season";
import { authOptions } from "@/auth";

export type SeasonFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  /** Echoed back on error so the admin's typing isn't lost when the form re-mounts. */
  values?: Record<string, string>;
  nonce?: string;
};

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
async function adminId() {
  return (await requireRole(authOptions, "admin")).id;
}
function finish(r: SeasonResult): SeasonFormState {
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", nonce: randomUUID() };
}
const invalid = (): SeasonFormState => ({ status: "error", error: "invalidDate", nonce: randomUUID() });

export async function storeWindowAction(_prev: SeasonFormState, fd: FormData): Promise<SeasonFormState> {
  const id = await adminId();
  const mode = z.enum(["auto", "open", "closed"]).safeParse(str(fd, "mode"));
  if (!mode.success) return invalid();
  return finish(await setStoreWindow(id, mode.data));
}

export async function forceFreezeAction(_prev: SeasonFormState, fd: FormData): Promise<SeasonFormState> {
  const id = await adminId();
  const parsed = z
    .object({ on: z.enum(["true", "false"]), confirm: z.enum(["yes", ""]) })
    .safeParse({ on: str(fd, "on"), confirm: str(fd, "confirm") });
  if (!parsed.success) return invalid();
  const on = parsed.data.on === "true";
  // Turning it ON stops every family changing their list: the form requires an explicit tick.
  if (on && parsed.data.confirm !== "yes") return { status: "error", error: "confirmRequired", nonce: randomUUID() };
  return finish(await setForceFrozen(id, on));
}

const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const datesSchema = z.object({ year: z.coerce.number().int().min(2026).max(2100), openDate: day, freezeDate: day, closeDate: day });

export async function datesAction(_prev: SeasonFormState, fd: FormData): Promise<SeasonFormState> {
  const id = await adminId();
  const raw = { year: str(fd, "year"), openDate: str(fd, "openDate"), freezeDate: str(fd, "freezeDate"), closeDate: str(fd, "closeDate") };
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.slice(0, 10)]));
  const parsed = datesSchema.safeParse(raw);
  if (!parsed.success) return { ...invalid(), values };
  const { year, ...dates } = parsed.data;
  const r = finish(await setSeasonDates(id, year, dates));
  return r.status === "error" ? { ...r, values } : r;
}
