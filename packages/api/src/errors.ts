import { COMMON_ERROR_STATUS_MAP, ORPCError, os } from "@orpc/server";

/** A code the client can receive. oRPC gives each one its HTTP status. */
export type PublicErrorCode = keyof typeof COMMON_ERROR_STATUS_MAP;

/**
 * The part of an error the client sees. An error class opts in by defining a
 * `publicError` getter; `message` is shown to users as written.
 */
export interface PublicError {
  readonly code: PublicErrorCode;
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

/** The `publicError` of `error`, if its class defines one. */
function publicErrorOf(error: unknown): PublicError | undefined {
  if (error instanceof Error && "publicError" in error) {
    const { publicError } = error;
    return isPublicError(publicError) ? publicError : undefined;
  }
  return undefined;
}

/**
 * Sends errors that define `publicError` to the client with that code and
 * message. Every other error passes through, and oRPC sends it as a generic
 * 500 that keeps its details on the server.
 */
export const sendPublicErrors = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    const publicError = publicErrorOf(error);
    if (publicError) {
      throw new ORPCError(publicError.code, {
        cause: error,
        message: publicError.message,
      });
    }
    throw error;
  }
});
