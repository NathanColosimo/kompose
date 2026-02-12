import { atom, getDefaultStore, useAtomValue } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import type { AuthClient, OrpcUtils } from "./types";

/**
 * Shared state configuration provided by the host app.
 */
export interface StateConfig {
  orpc: OrpcUtils;
  authClient: AuthClient;
  notifyError?: (error: Error) => void;
}

/**
 * Holds the host app configuration for shared state.
 */
export const stateConfigAtom = atom<StateConfig | null>(null);

/**
 * Shared query key for auth session reads.
 */
export const SESSION_QUERY_KEY = ["auth", "session"] as const;

/**
 * Shared session query atom used by both web and native state consumers.
 * Uses getSession (imperative Better Auth call) to avoid useSession subscriptions.
 */
export const sessionQueryAtom = atomWithQuery<unknown | null>((get) => {
  const { authClient } = getStateConfig(get);

  return {
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const result = await authClient.getSession();
      return result?.data?.user ?? null;
    },
    // We only need current session truthiness; retries add noise.
    retry: false,
    refetchOnWindowFocus: false,
  };
});

/**
 * Stores the latest resolved session user for app-level auth gating.
 */
export const sessionUserAtom = atom(
  (get) => get(sessionQueryAtom).data ?? null
);

/**
 * Tracks whether a user session is present.
 */
export const hasSessionAtom = atom((get) => Boolean(get(sessionUserAtom)));

/**
 * Tracks when the current session query has resolved at least once.
 */
export const sessionResolvedAtom = atom(
  (get) => !get(sessionQueryAtom).isPending
);

/**
 * Helper for atoms that need access to config via `get`.
 */
export function getStateConfig(
  get: (atom: typeof stateConfigAtom) => StateConfig | null
) {
  const config = get(stateConfigAtom);
  if (!config) {
    throw new Error("State config is not configured.");
  }
  return config;
}

/**
 * Hook for accessing config in React components/hooks.
 */
export function useStateConfig(): StateConfig {
  const config = useAtomValue(stateConfigAtom);
  if (!config) {
    throw new Error("State config is not configured.");
  }
  return config;
}

/**
 * Access config from the default store (non-hook contexts).
 */
export function getStateConfigFromStore(): StateConfig {
  const config = getDefaultStore().get(stateConfigAtom);
  if (!config) {
    throw new Error("State config is not configured.");
  }
  return config;
}
