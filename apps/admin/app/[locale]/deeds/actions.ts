"use server";
/**
 * Admin deed catalog actions. Each: requireRole admin → zod → @repo/deeds/catalog (change +
 * audit in one transaction) → refresh() (or redirect to the list after create/edit).
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { fieldErrors } from "@repo/auth/schemas";
import { createDeedType, moveDeedType, seedStarterDeeds, setDeedTypeActive, updateDeedType, type CatalogResult } from "@repo/deeds/catalog";
import { deedTypeSchema } from "@repo/deeds/schemas";
import { normalizeObjectId } from "@repo/lib/ids";
import { authOptions } from "@/auth";

export type DeedFormState = {
  status: "idle" | "done" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
  id?: string;
};

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
const FIELDS = ["titleEn", "titleEs", "descriptionEn", "descriptionEs", "tipMin", "tipMax"] as const;
const adminId = async () => (await requireRole(authOptions, "admin")).id;
function finish(r: CatalogResult): DeedFormState {
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", id: r.id, nonce: randomUUID() };
}

/** Create (no id) or edit (id). Values are echoed back on error so nothing typed is lost. */
export async function saveDeedAction(_prev: DeedFormState, fd: FormData): Promise<DeedFormState> {
  const admin = await adminId();
  const raw = Object.fromEntries(FIELDS.map((k) => [k, str(fd, k)]));
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.slice(0, 300)]));
  const parsed = deedTypeSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values, nonce: randomUUID() };
  const id = str(fd, "id");
  if (id && !normalizeObjectId(id)) return { status: "error", error: "notFound", values, nonce: randomUUID() };
  // version = updatedAt when the form was opened: a save made meanwhile isn't silently overwritten.
  const r = id ? await updateDeedType(admin, id, parsed.data, str(fd, "version")) : await createDeedType(admin, parsed.data);
  const out = finish(r);
  return out.status === "error" ? { ...out, values } : out;
}

const listOp = z.object({
  id: z.string().transform((v, ctx) => normalizeObjectId(v) ?? (ctx.addIssue({ code: "custom", message: "notFound" }), z.NEVER)),
  op: z.enum(["up", "down", "activate", "deactivate"]),
});

/** ↑ / ↓ / turn on / turn off, from the list. */
export async function deedListAction(_prev: DeedFormState, fd: FormData): Promise<DeedFormState> {
  const admin = await adminId();
  const parsed = listOp.safeParse({ id: str(fd, "id"), op: str(fd, "op") });
  if (!parsed.success) return { status: "error", error: "notFound", nonce: randomUUID() };
  const { id, op } = parsed.data;
  return finish(op === "up" || op === "down" ? await moveDeedType(admin, id, op) : await setDeedTypeActive(admin, id, op === "activate"));
}

export async function seedDeedsAction(): Promise<DeedFormState> {
  const admin = await adminId();
  return finish(await seedStarterDeeds(admin));
}
