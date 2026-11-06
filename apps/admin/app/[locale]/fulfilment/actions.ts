"use server";
/**
 * Admin fulfilment steps (Phase 6 slice 3b). Each: requireRole admin (a Server Action is a public
 * POST endpoint) → Zod → @repo/wishlists/fulfilment (compare-and-set + audit) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { arrangeSubstitute, markReceived, markSentToFamily } from "@repo/wishlists/fulfilment";
import { authOptions } from "@/auth";

export type StepState = { status: "idle" | "done" | "error"; error?: "notFound" | "changed" | "note"; emailed?: boolean; nonce?: string };

const idSchema = z.string().regex(OBJECT_ID_RE);
// Normalise Windows line breaks first so the length check matches what's stored.
const noteSchema = z.string().transform((v) => v.replace(/\r\n?/g, "\n").trim()).pipe(z.string().min(3).max(300));
const fail = (error: NonNullable<StepState["error"]>): StepState => ({ status: "error", error, nonce: randomUUID() });

export async function substituteAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const admin = await requireRole(authOptions, "admin");
  const id = idSchema.safeParse(fd.get("wishId"));
  if (!id.success) return fail("notFound");
  const note = noteSchema.safeParse(typeof fd.get("note") === "string" ? fd.get("note") : "");
  if (!note.success) return fail("note");
  const r = await arrangeSubstitute(admin.id, id.data, note.data);
  if (!r.ok) return fail(r.error);
  refresh();
  return { status: "done", nonce: randomUUID() };
}

export async function receivedAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const admin = await requireRole(authOptions, "admin");
  const id = idSchema.safeParse(fd.get("wishId"));
  if (!id.success) return fail("notFound");
  const r = await markReceived(admin.id, id.data);
  if (!r.ok) return fail(r.error);
  refresh();
  return { status: "done", nonce: randomUUID() };
}

export async function sentAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const admin = await requireRole(authOptions, "admin");
  const id = idSchema.safeParse(fd.get("wishId"));
  if (!id.success) return fail("notFound");
  const r = await markSentToFamily(admin.id, id.data);
  if (!r.ok) return fail(r.error);
  refresh();
  return { status: "done", emailed: r.emailed, nonce: randomUUID() };
}
