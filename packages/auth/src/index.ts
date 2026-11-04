/**
 * @repo/auth: NextAuth v4 config + authorization helpers. SERVER-ONLY.
 *
 *   import { createAuthOptions, requireRole } from "@repo/auth";
 *   import { unlockParentDashboard, isParentUnlocked } from "@repo/auth/parent-pin";
 *   import { hashSecret } from "@repo/auth/password";   // e.g. sign-up
 */
import "server-only";

export {
  createAuthOptions,
  MAX_FAILED_LOGINS,
  LOCKOUT_MINUTES,
} from "./options.ts";
export {
  getSessionUser,
  requireUser,
  requireRole,
  type SessionUser,
} from "./guards.ts";
