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
  // One test: the server's loaded model is module state, shared by every port.
  test("windows share one loaded model that parses like the in-thread parser", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    // Each channel stands in for one window's SharedWorker port.
    const channels = [new MessageChannel(), new MessageChannel()];
    try {
      const clients = await Promise.all(
        channels.map(({ port1, port2 }) => {
          taskParserHandler.upgrade(port1);
          port1.start();
          return connectTaskParser(port2, pathToFileURL(WEIGHTS_FILE).href);
        })
      );
      const tags = [{ id: "f", name: "Family" }];
      const text = "call mom tomorrow at 4 for 30m #family";
      const here = createTaskParser(shippedWeights())(text, { now, tags });
      const remotes = await Promise.all(
        clients.map((client) => client.parse({ now, tags, text }))
      );
      for (const remote of remotes) {
        // Stringified so the Temporal fields are compared too.
        expect(JSON.stringify(remote)).toBe(JSON.stringify(here));
        expect(remote.startDate).toBeInstanceOf(Temporal.PlainDate);
        expect(remote.startTime).toBeInstanceOf(Temporal.PlainTime);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      for (const { port1, port2 } of channels) {
        port1.close();
        port2.close();
      }
    }
  });
});
