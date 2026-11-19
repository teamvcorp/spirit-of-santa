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

type DashAction = (prev: DashFormState, fd: FormData) => Promise<DashFormState>;
/**
 * Wrap a dashboard action so success is reported from INSIDE the call: after refresh() the form may unmount (e.g.
 * the last photo removed), so a message set from the result alone could be lost. One copy for photos, logo, reps.
 */
export const reporting = (action: DashAction, onDone: () => void): DashAction => async (prev, fd) => {
  const result = await action(prev, fd);
  if (result.status === "done") onDone();
  return result;
};