import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind className helper.
 *
 * Mirrors the `cn` helper used by shadcn/ui and React Native Reusables so that
 * variants (CVA) and conditional class composition stay readable.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
