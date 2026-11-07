/**
 * Sign this browser out from the SERVER (e.g. right after the account was deleted, Phase 8). SERVER-ONLY.
 * The user record is already gone, so the 5-minute session re-check would refuse the token anyway; deleting
 * the cookie just makes it immediate. Uses the same cookie names next-auth uses (cookies.ts).
 */
import "server-only";
import { cookies } from "next/headers";
import type { AppName } from "@repo/lib/roles";
import { baseCookieOptions, cookieName } from "./cookies.ts";

export async function endSessionCookies(app: AppName): Promise<void> {
  const jar = await cookies();
  // Expire with the SAME options the cookie was set with: browsers ignore a Set-Cookie for a "__Host-" cookie
  // (production names) unless it repeats Secure + Path=/, so a bare delete() could silently do nothing.
  for (const name of ["session-token", "callback-url", "csrf-token"]) jar.set(cookieName(app, name), "", { ...baseCookieOptions(), maxAge: 0 });
}
