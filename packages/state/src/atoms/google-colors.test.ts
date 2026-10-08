import { expect, test } from "bun:test";
import type { Colors } from "@kompose/google-cal/schema";
import { QueryClient } from "@tanstack/query-core";
import {
  googleColorsQueryOptions,
  normalizeGoogleColors,
} from "./google-colors";

test("returning to a calendar reuses its palette, then refreshes after a day", async () => {
  const client = new QueryClient();
  let requests = 0;
  const palette: Colors = {
    event: { "1": { background: "#7986cb", foreground: "#000000" } },
  };
  const options = googleColorsQueryOptions("account-1", async () => {
    requests++;
    return palette;
  });
  try {
    await client.fetchQuery(options);
    client.setQueryData(options.queryKey, palette, {
      updatedAt: Date.now() - 21 * 60_000,
    });
    await client.fetchQuery(options);
    expect(requests).toBe(1);
    client.setQueryData(options.queryKey, palette, {
      updatedAt: Date.now() - 25 * 60 * 60_000,
    });
    await client.fetchQuery(options);
    expect(requests).toBe(2);
  } finally {
    client.clear();
  }
});

test("palette normalization reuses references without changing Google's colors", () => {
  const palette: Colors = { event: { "1": { background: "#7986cb" } } };
  const first = normalizeGoogleColors(palette);
  expect(normalizeGoogleColors(palette)).toBe(first);
  expect(first.event?.["1"]?.background).not.toBe("#7986cb");
  expect(palette.event?.["1"]?.background).toBe("#7986cb");
});
