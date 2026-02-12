"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useHydrateAtoms } from "jotai/utils";
import { queryClientAtom } from "jotai-tanstack-query";
import type { ReactNode } from "react";
import { type StateConfig, stateConfigAtom } from "./config";
import { type StorageAdapter, setStorageAdapter } from "./storage";

interface StateProviderProps {
  children: ReactNode;
  config: StateConfig;
  storage: StorageAdapter;
}

/**
 * Shared state hydrator for both web and native apps.
 * Uses the default Jotai store to allow non-hook access.
 */
export function StateProvider({
  children,
  config,
  storage,
}: StateProviderProps) {
  return (
    <StateHydrator config={config} storage={storage}>
      {children}
    </StateHydrator>
  );
}

function StateHydrator({
  children,
  config,
  storage,
}: {
  children: ReactNode;
  config: StateConfig;
  storage: StorageAdapter;
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

  return <>{children}</>;
}
