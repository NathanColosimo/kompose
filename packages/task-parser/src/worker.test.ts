import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Temporal } from "temporal-polyfill";
import { createTaskParser } from "./parser";
import { createWorkerTaskParser } from "./worker-client";

const weightsFile = new URL("../task-parser.bin", import.meta.url).pathname;
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe("worker parser", () => {
  test("parses like the in-thread parser", async () => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      type: "module",
    });
    const parse = await createWorkerTaskParser(
      worker,
      pathToFileURL(weightsFile).href
    );
    const file = readFileSync(weightsFile);
    const parseHere = createTaskParser(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
    const tags = [{ id: "f", name: "Family" }];
    const text = "call mom tomorrow at 4 for 30m #family";
    const remote = await parse(text, { now, tags });
    const here = parseHere(text, { now, tags });
    expect(remote).toEqual(here);
    expect(remote.startDate?.toString()).toBe(here.startDate?.toString());
    worker.terminate();
  });
});
