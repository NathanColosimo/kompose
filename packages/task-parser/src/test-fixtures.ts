/** The shipped weights and committed fixtures, for tests. */
import { readFileSync } from "node:fs";

export const WEIGHTS_FILE = new URL("../task-parser.bin", import.meta.url)
  .pathname;

/** The shipped weight file; fails clearly on a Git LFS pointer. */
export function shippedWeights(): ArrayBuffer {
  const file = readFileSync(WEIGHTS_FILE);
  if (file.toString("latin1", 0, 7) === "version") {
    throw new Error("task-parser.bin is a Git LFS pointer: run git lfs pull");
  }
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/** A file in training/testset/parity (written by training/model/dump_*.py). */
export function parityFixture<T>(name: string): T {
  const url = new URL(`../training/testset/parity/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}
