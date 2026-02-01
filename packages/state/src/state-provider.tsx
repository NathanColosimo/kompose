"use client";

import { useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
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

  // Hydrate config into the Jotai store.
  useHydrateAtoms([[stateConfigAtom, config]]);

  // Track session presence for query gating.
  const setHasSession = useSetAtom(hasSessionAtom);
  const session = config.authClient.useSession();

  React.useEffect(() => {
    setHasSession(Boolean(session?.data?.user));
  }, [session?.data, setHasSession]);

  return <>{children}</>;
}
