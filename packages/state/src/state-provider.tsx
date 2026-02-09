"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { queryClientAtom } from "jotai-tanstack-query";
import React from "react";
import { hasSessionAtom, type StateConfig, stateConfigAtom } from "./config";
import { type StorageAdapter, setStorageAdapter } from "./storage";

interface StateProviderProps {
  children: React.ReactNode;
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
  children: React.ReactNode;
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

  // Track session presence for query gating.
  const setHasSession = useSetAtom(hasSessionAtom);
  const session = config.authClient.useSession();

  React.useEffect(() => {
    setHasSession(Boolean(session?.data?.user));
  }, [session?.data, setHasSession]);

  return <>{children}</>;
}
