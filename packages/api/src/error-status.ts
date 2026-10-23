import { COMMON_ERROR_STATUS_MAP } from "@orpc/server";

/**
 * HTTP status for each error code. oRPC v2 sends unmapped codes as 400,
 * while v1 sent them as 500, so the app's custom codes are listed here to
 * keep reporting them as server failures.
 */
export const errorStatusMap: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
  ACCOUNT_NOT_LINKED: 500,
  GOOGLE_API_ERROR: 500,
  GOOGLE_MAPS_ERROR: 500,
  PARSE_ERROR: 500,
};
