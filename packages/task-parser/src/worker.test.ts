import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Temporal } from "temporal-polyfill";
import { createTaskParser } from "./parser";
import { createWorkerTaskParser } from "./worker-client";

const run =
  process.env.TASK_PARSER_RUN ??
  new URL("../training/runs/smoke/", import.meta.url).pathname;
const weightsFile = `${run}/task-parser.bin`;
const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

describe.skipIf(!existsSync(weightsFile))("worker parser", () => {
  test("parses like the in-thread parser", async () => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      type: "module",
    });
    const parser = await createWorkerTaskParser(
      worker,
      pathToFileURL(weightsFile).href
    );
    const file = readFileSync(weightsFile);
    const local = createTaskParser(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
    const tags = [{ id: "f", name: "Family" }];
    const text = "call mom tomorrow at 4 for 30m #family";
    const [remote, here] = await Promise.all([
      parser.parse(text, { now, tags }),
      local.parse(text, { now, tags }),
    ]);
    expect(remote).toEqual(here);
    expect(remote.startDate?.toString()).toBe(here.startDate?.toString());
    parser.terminate();
  });
});
