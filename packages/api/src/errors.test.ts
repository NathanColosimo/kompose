/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { GoogleApiError } from "@kompose/google-cal/client";
import { publicORPCError } from "./errors";

describe("what a client gets for an error", () => {
  test("a refused series write keeps its reason and occurrences", () => {
    const refusal = {
      originalStarts: ["2026-11-23T09:00:00-05:00"],
      reason: "dropsChangedOccurrences",
    } as const;
    const sent = publicORPCError(
      new GoogleApiError({ cause: new Error("refused"), refusal })
    );
    expect(sent?.code).toBe("BAD_REQUEST");
    expect(sent?.data).toEqual(refusal);
    expect(sent?.message).toContain("Nov 23");
  });

  test("a failed Google request says only to try again", () => {
    const sent = publicORPCError(
      new GoogleApiError({ cause: new Error("socket hang up") })
    );
    expect(sent?.code).toBe("BAD_GATEWAY");
    expect(sent?.data).toBeUndefined();
    expect(sent?.message).toBe("Google Calendar request failed. Try again.");
  });

  test("an error with no public part isn't turned into one", () => {
    expect(publicORPCError(new Error("database down"))).toBeUndefined();
  });
});
