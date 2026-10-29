import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { Temporal } from "temporal-polyfill";
import { createTaskParser } from "./parser";
import { shippedWeights, WEIGHTS_FILE } from "./test-fixtures";
import { connectTaskParser } from "./worker-client";

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("worker parser", () => {
  test("parses like the in-thread parser", async () => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      type: "module",
    });
    const client = await connectTaskParser(
      worker,
      pathToFileURL(WEIGHTS_FILE).href
    );
    const parseHere = createTaskParser(shippedWeights());
    const tags = [{ id: "f", name: "Family" }];
    const text = "call mom tomorrow at 4 for 30m #family";
    const remote = await client.parse({ now, tags, text });
    const here = parseHere(text, { now, tags });
    // Stringified so the Temporal fields are compared too.
    expect(JSON.stringify(remote)).toBe(JSON.stringify(here));
    expect(remote.startDate).toBeInstanceOf(Temporal.PlainDate);
    expect(remote.startTime).toBeInstanceOf(Temporal.PlainTime);
    worker.terminate();
  });
});
