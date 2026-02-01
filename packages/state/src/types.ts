import type { AppRouterClient } from "@kompose/api/routers/index";
import type { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { Account } from "better-auth";

/**
 * Minimal auth client shape used by shared state.
 */
export interface AuthClient {
  useSession: () => { data?: { user?: unknown } | null };
  listAccounts: () => Promise<{ data?: Account[] } | null>;
}

/**
 * Typed ORPC TanStack Query utils for the app router.
 */
export type OrpcUtils = ReturnType<
  typeof createTanstackQueryUtils<AppRouterClient>
>;
