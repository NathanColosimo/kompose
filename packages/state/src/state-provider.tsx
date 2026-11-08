"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useHydrateAtoms } from "jotai/utils";
import { queryClientAtom } from "jotai-tanstack-query";
import type { ReactNode } from "react";
import { type StateConfig, stateConfigAtom } from "./config";
import { type SubscribeToResume, useTodayTick } from "./hooks/use-today-tick";
import { type StorageAdapter, setStorageAdapter } from "./storage";

// Typed query meta, read by each app's query error handler: a misspelled
// key fails to compile instead of bringing its toast back.
declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /** The query shows its own failure: the app's error toast skips it. */
      quietError?: boolean;
    };
  }
}

interface StateProviderProps {
  children: ReactNode;
  config: StateConfig;
  storage: StorageAdapter;
  /** Platform-specific resume subscriber for immediate today/now refresh. */
  subscribeToResume?: SubscribeToResume;
}

/**
 * Shared state hydrator for both web and native apps.
 * Uses the default Jotai store to allow non-hook access.
 */
export function StateProvider({
  children,
  config,
  storage,
  subscribeToResume,
}: StateProviderProps) {
  // Ensure storage is available before any atom reads.
  setStorageAdapter(storage);

  // Share the same QueryClient between React Query and Jotai atoms.
  // Without this, atomWithQuery creates its own QueryClient and
  // queryClient.invalidateQueries / refetchQueries won't reach the atoms.
  const queryClient = useQueryClient();
  useHydrateAtoms([[stateConfigAtom, config]]);
  useHydrateAtoms([[queryClientAtom, queryClient]]);

  useTodayTick(subscribeToResume);

  return <>{children}</>;
}
