import { describe, expect, spyOn, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { Temporal } from "temporal-polyfill";
import { createTaskParser } from "./parser";
import { shippedWeights, WEIGHTS_FILE } from "./test-fixtures";
import { connectTaskParser } from "./worker-client";
import { taskParserHandler } from "./worker-server";

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

  test("windows connected to one worker share one loaded model", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    // Each channel stands in for one window's SharedWorker port.
    const channels = [new MessageChannel(), new MessageChannel()];
    try {
      const clients = await Promise.all(
        channels.map(({ port1, port2 }) => {
          taskParserHandler.upgrade(port1);
          port1.start();
          port2.start();
          return connectTaskParser(port2, pathToFileURL(WEIGHTS_FILE).href);
        })
      );
      const text = "call mom tomorrow at 4";
      const [first, second] = await Promise.all(
        clients.map((client) => client.parse({ now, tags: [], text }))
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    } finally {
      fetchSpy.mockRestore();
      for (const { port1, port2 } of channels) {
        port1.close();
        port2.close();
      }
    }
  });
});
