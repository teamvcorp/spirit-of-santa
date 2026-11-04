/**
 * User roles. CLIENT-SAFE: roles appear in UI, but authorization decisions are always made
 * on the server from the session, never from a role the client sends.
 *
 * Note: SpiritOfSanta.md also mentions a "community" role. Community members tip without an
 * account (Stripe guest checkout), so they are NOT a role here. Add one only if community
 * accounts become a feature.
 */
import { z } from "zod";

export const ROLES = ["child", "parent", "store_owner", "store_rep", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export type AppName = "family" | "store" | "admin";

/**
 * Which roles may sign in to which app. Each app's auth config rejects everyone else,
 * so e.g. a parent account can never obtain an admin.spiritofsanta.com session.
 */
export const APP_ROLES = {
  family: ["parent", "child"],
  store: ["store_owner", "store_rep"],
  admin: ["admin"],
} as const satisfies Record<AppName, readonly Role[]>;

export function isRoleAllowedInApp(role: Role, app: AppName): boolean {
  return (APP_ROLES[app] as readonly Role[]).includes(role);
}
