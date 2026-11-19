/**
 * STORE CHRISTMAS MAGIC GIFTS (founding partners slice 3, owner 2026-11-18). SERVER-ONLY.
 *
 * A store gives AS ITSELF through a single-use link: /donate?store=<token> on the family site. The link is emailed
 * ONLY to the store's confirmed owner (asked for by an admin, or by the owner from their dashboard). The store id
 * reaches Stripe ONLY from this token, on our server (metadata sos_store_id): the donate form never sends a store id.
 * The link is used up when the checkout is created (a new one can be sent any time).
 *
 * The gift itself is an ordinary donation: same pool (Dec 1 share-out), same acknowledgment box, same receipt. The only
 * differences: a higher card limit (MAX_STORE_GIFT_CENTS: $50,000 is a recommendation, not a cap) and the store gets
 * the North Star when its gifts this season reach the admin's threshold (@repo/stores/partners).
 */
import "server-only";
import { connectDb, Store, trusted, User } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale } from "@repo/lib/locales";
import { consumeActionToken, createActionToken, peekActionToken } from "@repo/auth/tokens";
import { familyAppOrigin } from "./urls.ts";

/** Stores that can give: live, or signed up and waiting (a partner often gives before going live). */
const GIVING_STATUSES = ["approved", "pending"] as const;

export type GiftLinkResult = { ok: true } | { ok: false; error: "notFound" | "noOwner" | "badStatus" | "notConfigured" | "emailFailed" };

/** Can this app build family-site links? (The store app needs FAMILY_APP_URL in production.) */
export function storeGiftLinksAvailable(): boolean {
  try {
    familyAppOrigin();
    return true;
  } catch {
    return false;
  }
}

/**
 * Email the store's CONFIRMED owner a fresh gift link (older unused links for this store stop working).
 * `actorUserId` = the admin or the owner asking (recorded on the token). Callers check their own role.
 */
export async function sendStoreGiftLink(storeId: string, actorUserId: string): Promise<GiftLinkResult> {
  await connectDb();
  const store = await Store.findById(storeId).select("name status ownerUserId").lean();
  if (!store) return { ok: false, error: "notFound" };
  if (!(GIVING_STATUSES as readonly string[]).includes(store.status)) return { ok: false, error: "badStatus" };
  const owner = store.ownerUserId ? await User.findById(store.ownerUserId).select("email locale status").lean() : null;
  if (!owner || owner.status !== "active") return { ok: false, error: "noOwner" }; // never to an unproven address
  let origin: string;
  try {
    origin = familyAppOrigin();
  } catch {
    return { ok: false, error: "notConfigured" };
  }
  const locale = isLocale(owner.locale) ? owner.locale : DEFAULT_LOCALE;
  const { raw } = await createActionToken("store_gift", { email: owner.email, storeId, createdByUserId: actorUserId });
  const link = new URL(localizePath("/donate", locale), origin);
  link.searchParams.set("store", raw);
  try {
    await sendEmail({ to: owner.email, locale, template: "storeGiftLink", values: { link: link.toString(), storeName: store.name } });
    return { ok: true };
  } catch (err) {
    console.error("[store-gifts] link email failed:", err instanceof Error ? err.name : "unknown"); // no address/link in logs
    return { ok: false, error: "emailFailed" };
  }
}

/** The store a gift link belongs to (shown on /donate), or null if the link is invalid/used/expired or the store can't give. */
export async function peekStoreGift(raw: unknown): Promise<{ storeId: string; storeName: string } | null> {
  await connectDb();
  const token = await peekActionToken(raw, "store_gift");
  if (!token?.storeId) return null;
  const store = await Store.findOne({ _id: token.storeId, status: trusted({ $in: [...GIVING_STATUSES] }) }).select("name").lean();
  return store ? { storeId: String(store._id), storeName: store.name } : null;
}

/** Use the link up (atomic: two tabs can't both use it). Returns the store id, or null. */
export async function consumeStoreGift(raw: unknown): Promise<string | null> {
  await connectDb();
  const token = await consumeActionToken(raw, "store_gift");
  return token?.storeId ? String(token.storeId) : null;
}
