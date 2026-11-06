/**
 * Create (or reset the password of) an ADMIN account. There is deliberately no public admin
 * sign-up; this script is the only way in. Run it from your own computer:
 *
 *   PowerShell:
 *     $env:MONGODB_URI = "<production URI>"
 *     $env:ADMIN_EMAIL = "you@example.com"
 *     $env:ADMIN_PASSWORD = "<a long passphrase, 12+ chars>"
 *     npm run admin:create
 *     Remove-Item Env:MONGODB_URI, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
 *
 * Security:
 *  - Password comes from the environment (not the command line, so it isn't saved in shell
 *    history), is hashed with argon2id, and is never printed.
 *  - Refuses to turn an existing NON-admin account (parent/store) into an admin.
 *  - Re-running for an existing admin resets the password, TURNS OFF their two-step sign-in
 *    (the lost-phone path: they set it up again at the next sign-in) and signs out their sessions.
 *  - A new admin must set up two-step sign-in (authenticator app) at the first sign-in.
 */
import { connectDb, User } from "@repo/db";
import { emailSchema } from "../src/schemas.ts";
import { hashSecret, MAX_SECRET_LENGTH } from "../src/password.ts";
import { resetMfa } from "../src/mfa.ts";

function fail(msg: string): never {
  console.error(`[admin] ${msg}`);
  process.exit(1);
}

async function main() {
  /* eslint-disable turbo/no-undeclared-env-vars -- manual script, not a turbo task */
  const email = emailSchema.safeParse(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  /* eslint-enable turbo/no-undeclared-env-vars */
  if (!email.success) fail("set ADMIN_EMAIL to a valid email address");
  if (password.length < 12 || password.length > MAX_SECRET_LENGTH) fail(`set ADMIN_PASSWORD (12–${MAX_SECRET_LENGTH} characters)`);

  const conn = await connectDb();
  const existing = await User.findOne({ email: email.data }).select("role mfa.enabled").lean();
  if (existing && existing.role !== "admin") {
    await conn.disconnect();
    fail("that email already belongs to a non-admin account; use a different email");
  }
  const passwordHash = await hashSecret(password);
  await User.findOneAndUpdate(
    { email: email.data },
    {
      $set: { passwordHash, role: "admin", status: "active", failedLoginCount: 0 },
      $unset: { lockedUntil: 1 },
      $inc: { sessionVersion: 1 },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  // Lost-phone path: turn MFA off through resetMfa() so it's AUDITED (review 2026-11-05).
  if (existing?.mfa?.enabled) await resetMfa(String(existing._id));
  console.log(`[admin] ${existing ? "password + two-step sign-in reset for" : "created"} admin ${email.data} in database "${conn.connection.name}"`);
  console.log("[admin] at the next sign-in they'll be asked to set up an authenticator app.");
  await conn.disconnect();
}

main().catch((err: unknown) => fail(err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"));
