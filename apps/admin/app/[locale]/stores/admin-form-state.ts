/** Result shape of the admin store Server Actions (client-safe type). */
export type AdminFormState = {
  status: "idle" | "done" | "error";
  /** notFound | badStatus | emailInUse → StoreAdmin.errors.<code> */
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
  storeId?: string;
  /** The change was saved but its email could not be sent (e.g. invite). */
  emailFailed?: boolean;
};
export const INITIAL_ADMIN_STATE: AdminFormState = { status: "idle" };