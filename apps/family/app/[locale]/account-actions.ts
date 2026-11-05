"use server";
/**
 * Server Actions for this app's account pages. Thin wrappers: all validation, rate limiting
 * and security live in @repo/auth/form-actions (shared by every app). The app name here
 * decides which roles may reset a password through this site.
 */
import { forgotPassword, resetPasswordWithToken } from "@repo/auth/form-actions";
import type { FormState } from "@repo/auth/form-state";

export async function forgotPasswordAction(prev: FormState, fd: FormData) {
  return forgotPassword("family", prev, fd);
}
export async function resetPasswordAction(prev: FormState, fd: FormData) {
  return resetPasswordWithToken(prev, fd);
}
