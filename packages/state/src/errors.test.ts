import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  test("shows the API's message", () => {
    const error = new ORPCError("CONFLICT", {
      message: 'A tag named "Work" already exists.',
    });
    expect(errorMessage(error)).toBe('A tag named "Work" already exists.');
  });

  test("hides the message of an unexpected server error", () => {
    const error = new ORPCError("INTERNAL_SERVER_ERROR");
    expect(errorMessage(error)).toBe("Something went wrong. Try again.");
  });

  test("explains a network failure", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(
      "Couldn't reach Kompose. Check your connection and try again."
    );
  });

  test("shows the message of other errors", () => {
    expect(errorMessage(new Error("Failed to unlink account."))).toBe(
      "Failed to unlink account."
    );
  });
});
