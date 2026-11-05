/** What every account-form Server Action returns (client-safe type, no server code). */
export type FormState = {
  status: "idle" | "sent" | "done" | "error";
  /** Form-level error code → Common.accounts.errors.<code>. */
  error?: "rateLimited" | "invalidLink";
  /** Field → error code → Common.formErrors.<code>. */
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values (never passwords) to refill the form after an error. */
  values?: Record<string, string>;
  /**
   * New random value per failed submit. Forms use it as their React `key`, so the form
   * re-mounts with `values` as defaults. (React 19 resets a form after its action runs;
   * selects and checkboxes don't pick their echoed defaults back up without a re-mount.)
   */
  nonce?: string;
};

export const INITIAL_FORM_STATE: FormState = { status: "idle" };
