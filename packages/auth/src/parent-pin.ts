/**
 * Parent PIN. SERVER-ONLY.
 *
 * Kids use the family app on a parent's signed-in device. The parent dashboard (item caps,
 * bonus magic, Naughty/Nice vote) needs a 4–6 digit PIN on top of the login session.
 *
 *   - The PIN is stored as an argon2id hash on Family.parentPinHash.
 *   - 5 wrong PINs → 15 min PIN lockout. With only 10^4–10^6 possible PINs, the
 *     lockout is what makes guessing impractical.
 *   - A correct PIN sets a SEPARATE short-lived cookie (15 min) holding an HMAC-signed
 *     "unlocked for family F by user U until T" token. It's bound to the family and user,
 *     so it can't be replayed from another account, and it's HttpOnly + SameSite=Strict.
 *
 * Server Action usage:
 *   const user = await requireRole(authOptions, "parent");
 *   const ok = await unlockParentDashboard(user, formData.get("pin"));
 *   ... later, in parent-only actions/pages:
 *   if (!(await isParentUnlocked(user))) redirect("/parent/pin");
 */
import "server-only";
import { cookies } from "next/headers";
import { connectDb, Family } from "@repo/db";
import { baseCookieOptions, cookieName } from "./cookies.ts";
import { hashSecret, verifySecret } from "./password.ts";
import { pinSchema } from "./schemas.ts";
import {
  PIN_UNLOCK_SECONDS,
  signUnlockToken,
  verifyUnlockToken,
} from "./unlock-token.ts";

export { pinSchema, PIN_UNLOCK_SECONDS };

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCKOUT_MINUTES = 15;

// ── Session-facing API ─────────────────────────────────────────────────────────────────
function requireSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

const UNLOCK_COOKIE = () => cookieName("family", "parent-unlock");

type ParentUser = { id: string; familyId?: string };

/** Set or change the family PIN. Caller must already have verified the parent (and old PIN). */
export async function setParentPin(
  familyId: string,
  pin: unknown,
): Promise<void> {
  const parsed = pinSchema.parse(pin);
  await connectDb();
  await Family.updateOne(
    { _id: familyId },
    {
      $set: { parentPinHash: await hashSecret(parsed), pinFailedCount: 0 },
      $unset: { pinLockedUntil: 1 },
    },
  );
}

/** Verify the PIN; on success set the unlock cookie. Returns false on any failure. */
export async function unlockParentDashboard(
  user: ParentUser,
  pin: unknown,
): Promise<boolean> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success || !user.familyId) return false;

  await connectDb();
  const family = await Family.findOne({
    _id: user.familyId,
    ownerUserId: user.id,
  }).select("+parentPinHash +pinFailedCount +pinLockedUntil");
  if (!family?.parentPinHash) return false;
  if (family.pinLockedUntil && family.pinLockedUntil > new Date()) return false;

  if (!(await verifySecret(parsed.data, family.parentPinHash))) {
    const after = await Family.findOneAndUpdate(
      { _id: family._id },
      { $inc: { pinFailedCount: 1 } },
      { returnDocument: "after", projection: { pinFailedCount: 1 } },
    ).select("+pinFailedCount");
    if ((after?.pinFailedCount ?? 0) >= PIN_MAX_FAILURES) {
      await Family.updateOne(
        { _id: family._id },
        {
          $set: {
            pinLockedUntil: new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000),
            pinFailedCount: 0,
          },
        },
      );
    }
    return false;
  }

  await Family.updateOne({ _id: family._id }, { $set: { pinFailedCount: 0 } });
  (await cookies()).set(
    UNLOCK_COOKIE(),
    signUnlockToken(
      { familyId: user.familyId, userId: user.id },
      requireSecret(),
    ),
    { ...baseCookieOptions(), sameSite: "strict", maxAge: PIN_UNLOCK_SECONDS },
  );
  return true;
}

/** True while this parent's PIN unlock is valid. */
export async function isParentUnlocked(user: ParentUser): Promise<boolean> {
  if (!user.familyId) return false;
  const token = (await cookies()).get(UNLOCK_COOKIE())?.value;
  return verifyUnlockToken(
    token,
    { familyId: user.familyId, userId: user.id },
    requireSecret(),
  );
}

/** Re-lock (e.g. "Back to kids" button). */
export async function lockParentDashboard(): Promise<void> {
  (await cookies()).delete(UNLOCK_COOKIE());
}
