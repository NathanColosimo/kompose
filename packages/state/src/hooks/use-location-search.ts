import type { LocationSuggestion } from "@kompose/api/routers/maps/contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useStateConfig } from "../config";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export function useLocationSearch(query: string) {
  const { orpc } = useStateConfig();
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setDebounced(trimmed);
      return;
    }

    const handle = setTimeout(() => {
      setDebounced(trimmed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  return useQuery<LocationSuggestion[]>({
    ...orpc.maps.search.queryOptions({
      input: { query: debounced },
    }),
    enabled: debounced.length >= MIN_QUERY_LENGTH,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
