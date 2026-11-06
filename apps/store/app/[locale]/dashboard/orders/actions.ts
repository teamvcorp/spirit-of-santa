"use server";
/**
 * "Mark shipped" (owner or rep). requireRole → Zod → @repo/wishlists/fulfilment.markShipped,
 * which re-checks store membership in the DB, that the gift is THIS store's, LOCKED and not
 * waiting for a substitute (compare-and-set: a double click ships once) → refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@repo/auth";
import { OBJECT_ID_RE } from "@repo/lib/ids";
import { markShipped } from "@repo/wishlists/fulfilment";
import { authOptions } from "@/auth";

const schema = z.object({
  wishId: z.string().regex(OBJECT_ID_RE),
  // Optional "UPS 1Z999..." (plain text, shown back to Spirit O Santa's team only).
  tracking: z.string().trim().max(100),
});

export type ShipState = { status: "idle" | "done" | "error"; error?: "notFound" | "notReady" | "tracking"; nonce?: string };

export async function markShippedAction(_prev: ShipState, fd: FormData): Promise<ShipState> {
  const u = await requireRole(authOptions, "store_owner", "store_rep");
  const raw = { wishId: fd.get("wishId"), tracking: typeof fd.get("tracking") === "string" ? fd.get("tracking") : "" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { status: "error", error: parsed.error.issues[0]?.path[0] === "tracking" ? "tracking" : "notFound", nonce: randomUUID() };
  const r = await markShipped({ id: u.id, role: u.role, storeId: u.storeId }, parsed.data.wishId, parsed.data.tracking);
  if (!r.ok) return { status: "error", error: r.error, nonce: randomUUID() };
  refresh();
  return { status: "done", nonce: randomUUID() };
}
