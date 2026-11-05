import type { AppRouterClient } from "@kompose/api/routers/index";
import { atom, useAtomValue } from "jotai";
import type { AuthClient } from "./types";

export interface StateConfig {
  authClient: AuthClient;
  notifyError?: (error: Error) => void;
  orpc: AppRouterClient;
}

export const stateConfigAtom = atom<StateConfig | null>(null);

export function getStateConfig(
  get: (atom: typeof stateConfigAtom) => StateConfig | null
) {
  const config = get(stateConfigAtom);
  if (!config) {
    throw new Error("State config is not configured.");
  }
  return config;
}

export function useStateConfig(): StateConfig {
  const config = useAtomValue(stateConfigAtom);
  if (!config) {
    throw new Error("State config is not configured.");
  }
  return config;
}
