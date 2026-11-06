/**
 * READ-ONLY check of an admin account (sign-in troubleshooting). Changes nothing. Run it from
 * your own computer against the database the site uses:
 *
 *   PowerShell:
 *     $env:MONGODB_URI = '<the MONGODB_URI from the Vercel admin project>'
 *     $env:ADMIN_EMAIL = 'you@example.com'
 *     $env:ADMIN_PASSWORD = '<the password you type on the sign-in page>'
 *     npm run admin:check
 *     Remove-Item Env:MONGODB_URI, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
 *
 * Prints the database name and facts about the account (exists, role, status, two-step sign-in,
 * failed tries, lockout, password matches yes/no). NEVER prints the URI, password or hash.
 * If everything here is fine but the website still says "That didn't work", the problem is on
 * the server side: check Vercel → admin → Logs for "[auth] sign-in error:" (docs/PRODUCTION-SETUP.md).
 */
import { connectDb, User } from "@repo/db";
import { emailSchema } from "../src/schemas.ts";
import { verifySecret } from "../src/password.ts";

async function main() {
  /* eslint-disable turbo/no-undeclared-env-vars -- manual script, not a turbo task */
  const email = emailSchema.safeParse(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  /* eslint-enable turbo/no-undeclared-env-vars */
  if (!email.success) {
    console.error("[check] set ADMIN_EMAIL to a valid email address");
    process.exit(1);
  }
  const conn = await connectDb();
  console.log(`[check] database: "${conn.connection.name}"`);
  const u = await User.findOne({ email: email.data }).select("+passwordHash +failedLoginCount +lockedUntil role status mfa.enabled").lean();
  if (!u) {
    console.log(`[check] no account with email ${email.data} in this database`);
  } else {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    console.log(`[check] account found: role=${u.role} status=${u.status} twoStep=${u.mfa?.enabled ? "on" : "not set up yet"}`);
    console.log(`[check] failed tries: ${u.failedLoginCount ?? 0}${locked ? ` · LOCKED until ${new Date(u.lockedUntil!).toISOString()} (re-run admin:create to clear)` : " · not locked"}`);
    if (password) console.log(`[check] password matches: ${(await verifySecret(password, u.passwordHash)) ? "YES" : "NO"}`);
    else console.log("[check] (set ADMIN_PASSWORD to also test the password)");
  }
  await conn.disconnect();
}

main().catch((err: unknown) => {
  console.error(`[check] ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`);
  process.exit(1);
});
