/**
 * false during server render and hydration, true once React runs in the browser.
 *
 * Why forms use it: a Server Action form can be submitted BEFORE JavaScript has loaded (a
 * plain browser POST). The action still runs, but with Cache Components the production
 * response doesn't show its result, so the user would see an unchanged form after, say,
 * their account was created. Keeping submit buttons disabled until hydration (a fraction of
 * a second) avoids that. Same approach as the sign-in form (which also avoids a GET submit).
 */
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}