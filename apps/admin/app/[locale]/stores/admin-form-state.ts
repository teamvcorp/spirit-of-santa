/** Result shape of the admin store Server Actions (client-safe type). */
export type AdminFormState = {
  status: "idle" | "done" | "error";
  /** notFound | badStatus | emailInUse → StoreAdmin.errors.<code> */
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
  storeId?: string;
};
export const INITIAL_ADMIN_STATE: AdminFormState = { status: "idle" };