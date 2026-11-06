import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  isLiveSubscription,
  saveReplacement,
  WATCH_RENEWAL_BUFFER_MS,
  watchDecision,
} from "./reconciliation";

const now = Date.parse("2026-11-06T12:00:00Z");
const old = { active: true, expiresAt: new Date(now + 1000).toISOString() };

describe("watch reconciliation decisions", () => {
  test("expiry controls liveness even when an expired row is active", () => {
    expect(isLiveSubscription(old, now)).toBe(true);
    expect(isLiveSubscription(old, now + 1000)).toBe(false);
    expect(watchDecision({ existing: old, now })).toBe("replace");
    expect(watchDecision({ existing: { ...old, expiresAt: null }, now })).toBe(
      "replace"
    );
    expect(
      watchDecision({ existing: { ...old, expiresAt: "invalid" }, now })
    ).toBe("replace");
  });

  test("keeps a fresh watch but renews stopped watches", () => {
    const fresh = {
      ...old,
      expiresAt: new Date(now + WATCH_RENEWAL_BUFFER_MS + 1).toISOString(),
    };
    expect(watchDecision({ existing: fresh, now })).toBe("keep");
    expect(watchDecision({ existing: { ...fresh, active: false }, now })).toBe(
      "replace"
    );
  });

  test("unsupported calendars wait until their persisted retry time", () => {
    const unsupportedUntil = new Date(now + 1000).toISOString();
    expect(watchDecision({ now, unsupportedUntil })).toBe("retry-later");
    expect(watchDecision({ now: now + 999, unsupportedUntil })).toBe(
      "retry-later"
    );
    expect(watchDecision({ now: now + 1000, unsupportedUntil })).toBe(
      "replace"
    );
  });

  test("failed replacement leaves the old channel tracked", async () => {
    let tracked = "old-channel";
    const result = await Effect.runPromise(
      Effect.result(
        saveReplacement({
          create: Effect.fail("Google unavailable"),
          save: (channel: string) =>
            Effect.sync(() => {
              tracked = channel;
            }),
        })
      )
    );
    expect(result._tag).toBe("Failure");
    expect(tracked).toBe("old-channel");
  });

  test("unsupported replacement leaves the old channel tracked", async () => {
    let tracked = "old-channel";
    const saved = await Effect.runPromise(
      saveReplacement({
        create: Effect.succeed(undefined),
        save: () =>
          Effect.sync(() => {
            tracked = "replacement";
          }),
      })
    );
    expect(saved).toBe(false);
    expect(tracked).toBe("old-channel");
  });
});
