"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useHydrateAtoms } from "jotai/utils";
import { queryClientAtom } from "jotai-tanstack-query";
import type { ReactNode } from "react";
import { type StateConfig, stateConfigAtom } from "./config";
import { type SubscribeToResume, useTodayTick } from "./hooks/use-today-tick";
import { type StorageAdapter, setStorageAdapter } from "./storage";

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
  return (
    <StateHydrator
      config={config}
      storage={storage}
      subscribeToResume={subscribeToResume}
    >
      {children}
    </StateHydrator>
  );
}

function StateHydrator({
  children,
  config,
  storage,
  subscribeToResume,
}: {
  children: ReactNode;
  config: StateConfig;
  storage: StorageAdapter;
  subscribeToResume?: SubscribeToResume;
}) {
  // Ensure storage is available before any atom reads.
  setStorageAdapter(storage);

  // Share the same QueryClient between React Query and Jotai atoms.
  // Without this, atomWithQuery creates its own QueryClient and
  // queryClient.invalidateQueries / refetchQueries won't reach the atoms.
  const queryClient = useQueryClient();
  useHydrateAtoms([
    [stateConfigAtom, config],
    [queryClientAtom, queryClient],
  ]);

  // Keep today/now atoms fresh across midnight boundaries and app resume.
  useTodayTick(subscribeToResume);

  return <>{children}</>;
}
