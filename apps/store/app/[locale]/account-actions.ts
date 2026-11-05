"use server";
/**
 * Server Actions for this app's account pages. Thin wrappers: all validation, rate limiting
 * and security live in @repo/auth/form-actions (shared by every app). The app name here
 * decides which roles may reset a password through this site.
 */
import { acceptInvite, acceptRepInviteForm, confirmEmailWithToken, forgotPassword, registerStore, resendVerificationEmail, resetPasswordWithToken } from "@repo/auth/form-actions";
import type { FormState } from "@repo/auth/form-state";

export async function forgotPasswordAction(prev: FormState, fd: FormData) {
  return forgotPassword("store", prev, fd);
}
export async function resetPasswordAction(prev: FormState, fd: FormData) {
  return resetPasswordWithToken(prev, fd);
}

/** Store self-registration (store app only). */
export async function registerStoreAction(prev: FormState, fd: FormData) {
  return registerStore(prev, fd);
}
export async function confirmEmailAction(prev: FormState, fd: FormData) {
  return confirmEmailWithToken(prev, fd);
}
export async function resendVerificationAction(prev: FormState, fd: FormData) {
  return resendVerificationEmail(prev, fd);
}
export async function acceptInviteAction(prev: FormState, fd: FormData) {
  return acceptInvite(prev, fd);
}
export async function acceptRepInviteAction(prev: FormState, fd: FormData) {
  return acceptRepInviteForm(prev, fd);
}
