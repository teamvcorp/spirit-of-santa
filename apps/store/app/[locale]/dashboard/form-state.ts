/** Result of the dashboard Server Actions (client-safe type). */
export type DashFormState = {
  status: "idle" | "done" | "error";
  /** notFound | readOnly | tooManyPhotos | emailInUse | rateLimited | empty | too_large | unsupported_type | unreadable */
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  nonce?: string;
};
export const INITIAL_DASH_STATE: DashFormState = { status: "idle" };