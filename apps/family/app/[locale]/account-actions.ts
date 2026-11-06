"use server";
/**
 * Server Actions for this app's account pages. Thin wrappers: all validation, rate limiting
 * and security live in @repo/auth/form-actions (shared by every app). The app name here
 * decides which roles may reset a password / get a confirm email through this site.
 */
import { confirmEmailWithToken, forgotPassword, registerParentForm, resendVerificationEmail, resetPasswordWithToken } from "@repo/auth/form-actions";
import type { FormState } from "@repo/auth/form-state";

export async function forgotPasswordAction(prev: FormState, fd: FormData) {
  return forgotPassword("family", prev, fd);
}
export async function resetPasswordAction(prev: FormState, fd: FormData) {
  return resetPasswordWithToken(prev, fd);
}
/** Parent sign-up (COPPA consent recorded with the policy version). */
export async function registerParentAction(prev: FormState, fd: FormData) {
  return registerParentForm(prev, fd);
}
export async function confirmEmailAction(prev: FormState, fd: FormData) {
  return confirmEmailWithToken(prev, fd);
}
export async function resendVerificationAction(prev: FormState, fd: FormData) {
  return resendVerificationEmail("family", prev, fd);
}
