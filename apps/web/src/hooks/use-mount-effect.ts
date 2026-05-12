import { useEffect } from "react";

// biome-ignore lint/suspicious/noConfusingVoidType: mount only
export function useMountEffect(effect: () => void | (() => void)) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount only
  useEffect(effect, []);
}
