import { describe, expect, test } from "bun:test";
import { commandBarInputReducer } from "./command-bar-input";

describe("command bar submission revisions", () => {
  test("finishing A preserves B typed while resolving or creating", () => {
    const submitted = { revision: 1, text: "A" };
    const current = commandBarInputReducer(submitted, {
      text: "B",
      type: "change",
    });
    expect(
      commandBarInputReducer(current, {
        revision: submitted.revision,
        type: "created",
      })
    ).toBe(current);
  });
});

test("typing B then A again still counts as a newer draft", () => {
  const submitted = { revision: 1, text: "A" };
  const changed = commandBarInputReducer(submitted, {
    text: "B",
    type: "change",
  });
  const current = commandBarInputReducer(changed, {
    text: "A",
    type: "change",
  });
  expect(
    commandBarInputReducer(current, {
      revision: submitted.revision,
      type: "created",
    })
  ).toBe(current);
});

test("success clears only the submitted revision, once", () => {
  const submitted = { revision: 1, text: "A" };
  const cleared = commandBarInputReducer(submitted, {
    revision: 1,
    type: "created",
  });
  expect(cleared.text).toBe("");
  expect(
    commandBarInputReducer(cleared, { revision: 1, type: "created" })
  ).toBe(cleared);
});

test("leaving and reopening Create invalidates its earlier submission", () => {
  const submitted = { revision: 1, text: "A" };
  const root = commandBarInputReducer(submitted, { text: "", type: "change" });
  const reopened = commandBarInputReducer(root, { text: "B", type: "change" });
  expect(
    commandBarInputReducer(reopened, { revision: 1, type: "created" })
  ).toBe(reopened);
});
