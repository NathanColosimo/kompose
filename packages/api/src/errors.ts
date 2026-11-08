import { COMMON_ERROR_STATUS_MAP, ORPCError, os } from "@orpc/server";

export type PublicErrorCode = keyof typeof COMMON_ERROR_STATUS_MAP;

/**
 * The part of an error the client sees. An error class opts in by defining a
 * `publicError` getter; `message` is shown to users as written, and `data`,
 * when given, is typed detail for the client to act on (which occurrences a
 * refused series write would drop, say).
 */
export interface PublicError {
  readonly code: PublicErrorCode;
  readonly data?: unknown;
  readonly message: string;
}

function isPublicError(value: unknown): value is PublicError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { code, message } = value as Record<string, unknown>;
  return (
    typeof code === "string" &&
    Object.hasOwn(COMMON_ERROR_STATUS_MAP, code) &&
    typeof message === "string"
  );
}

function publicErrorOf(error: unknown): PublicError | undefined {
  if (error instanceof Error && "publicError" in error) {
    const { publicError } = error;
    return isPublicError(publicError) ? publicError : undefined;
  }
  return undefined;
}

/**
 * The ORPCError a client gets for `error`: its public code, message and
 * data. Undefined for an error with no public part.
 */
export function publicORPCError(error: unknown) {
  const publicError = publicErrorOf(error);
  return publicError
    ? new ORPCError(publicError.code, {
        cause: error,
        data: publicError.data,
        message: publicError.message,
      })
    : undefined;
}

/**
 * Expose only an error's explicit public message and data. Other errors pass
 * through: oRPC preserves ORPCErrors and hides unexpected errors behind a
 * generic 500. See documents/services.md for the client error policy.
 */
export const sendPublicErrors = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw publicORPCError(error) ?? error;
  }
});
