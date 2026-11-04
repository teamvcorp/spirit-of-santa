/**
 * NextAuth config for the family app. Import `authOptions` wherever you need the session:
 *
 *   import { authOptions } from "@/auth";
 *   import { requireRole } from "@repo/auth";
 *   const user = await requireRole(authOptions, ...);
 */
import "server-only";
import { createAuthOptions } from "@repo/auth";

export const authOptions = createAuthOptions("family");
