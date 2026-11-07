/**
 * "Type your password again" for sensitive actions by a signed-in user (PIN setup, deleting the family
 * account). SERVER-ONLY. Same lockout as sign-in (LOGIN_ATTEMPTS, reserved BEFORE verifying: attempts.ts),
 * so it can never become a password-guessing endpoint that skips the lockout.
 */
import "server-only";
import { connectDb, User } from "@repo/db";
import { failAttempt, releaseAttempt, reserveAttempt, unlocked } from "./attempts.ts";
import { LOGIN_ATTEMPTS } from "./options.ts";
import { burnVerifyTime, MAX_SECRET_LENGTH, verifySecret } from "./password.ts";

/** true = this active user's password is right. Locked accounts and wrong passwords look the same (false). */
export async function verifyAccountPassword(userId: string, password: unknown, filter: Record<string, unknown> = {}): Promise<boolean> {
  if (typeof password !== "string" || !password || password.length > MAX_SECRET_LENGTH) return false;
  await connectDb();
  const account = await User.findOne({ _id: userId, status: "active", ...filter }).select("+passwordHash").lean();
  if (!account) {
    await burnVerifyTime(password); // same timing as a wrong password
    return false;
  }
  const me = { _id: account._id };
  if (!(await reserveAttempt(User, me, LOGIN_ATTEMPTS))) {
    await burnVerifyTime(password);
    return false;
  }
  let right: boolean;
  try {
    right = await verifySecret(password, account.passwordHash);
  } catch (err) {
    await releaseAttempt(User, me, LOGIN_ATTEMPTS).catch(() => {}); // a crash is not a strike
    throw err;
  }
  if (!right) {
    await failAttempt(User, me, LOGIN_ATTEMPTS);
    return false;
  }
  // Right password: clears earlier strikes too, like a sign-in (only while unlocked: never undo a lock
  // another request set meanwhile).
  await User.updateOne({ ...me, ...unlocked(LOGIN_ATTEMPTS) }, { $set: { failedLoginCount: 0 } });
  return true;
}
