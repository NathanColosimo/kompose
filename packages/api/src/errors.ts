import { COMMON_ERROR_STATUS_MAP, ORPCError, os } from "@orpc/server";

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

function publicErrorOf(error: unknown): PublicError | undefined {
  if (error instanceof Error && "publicError" in error) {
    const { publicError } = error;
    return isPublicError(publicError) ? publicError : undefined;
  }
  return undefined;
}

/**
 * Expose only an error's explicit public message. Other errors pass through:
 * oRPC preserves ORPCErrors and hides unexpected errors behind a generic 500.
 * See documents/services.md for the client error policy.
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
