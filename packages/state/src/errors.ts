import { ORPCError } from "@orpc/client";

const UNEXPECTED_MESSAGE = "Something went wrong. Try again.";
const OFFLINE_MESSAGE =
  "Couldn't reach Kompose. Check your connection and try again.";

/**
 * The text to show a user for a failed request. The API writes the message of
 * every error it sends except unexpected 500s, which get a generic one.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ORPCError) {
    return error.code === "INTERNAL_SERVER_ERROR"
      ? UNEXPECTED_MESSAGE
      : error.message;
  }
  // fetch rejects with a TypeError when the network request itself fails.
  if (error instanceof TypeError) {
    return OFFLINE_MESSAGE;
  }
  return error instanceof Error && error.message
    ? error.message
    : UNEXPECTED_MESSAGE;
}
