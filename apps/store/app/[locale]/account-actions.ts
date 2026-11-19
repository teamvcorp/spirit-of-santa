"use server";
/**
 * Server Actions for this app's account pages. Thin wrappers: all validation, rate limiting
 * and security live in @repo/auth/form-actions (shared by every app). The app name here
 * decides which roles may reset a password through this site.
 */
import { acceptInvite, acceptRepInviteForm, completeStoreSignupForm, confirmEmailWithToken, forgotPassword, requestStoreSignupForm, resendVerificationEmail, resetPasswordWithToken } from "@repo/auth/form-actions";
import type { FormState } from "@repo/auth/form-state";

export async function forgotPasswordAction(prev: FormState, fd: FormData) {
  return forgotPassword("store", prev, fd);
}
export async function resetPasswordAction(prev: FormState, fd: FormData) {
  return resetPasswordWithToken(prev, fd);
}

/** Store self-registration (store app only). */
/** Store sign-up is email first (owner 2026-11-19): step 1 sends the link, step 2 (from the link) creates the store. */
export async function requestStoreSignupAction(prev: FormState, fd: FormData) {
  return requestStoreSignupForm(prev, fd);
}
export async function completeStoreSignupAction(prev: FormState, fd: FormData) {
  return completeStoreSignupForm(prev, fd);
}
export async function confirmEmailAction(prev: FormState, fd: FormData) {
  return confirmEmailWithToken(prev, fd);
}
export async function resendVerificationAction(prev: FormState, fd: FormData) {
  return resendVerificationEmail("store", prev, fd);
}
export async function acceptInviteAction(prev: FormState, fd: FormData) {
  return acceptInvite(prev, fd);
}
export async function acceptRepInviteAction(prev: FormState, fd: FormData) {
  return acceptRepInviteForm(prev, fd);
}
