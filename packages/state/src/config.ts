import { atom, getDefaultStore, useAtomValue } from "jotai";
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
 * Tracks whether a user session is present.
 */
export const hasSessionAtom = atom<boolean>(false);

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
