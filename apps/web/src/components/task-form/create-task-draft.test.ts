import { expect, test } from "bun:test";
import { createTaskDraftReducer } from "./create-task-draft";

test("completion for dismissed A cannot close reopened draft B", () => {
  const submitted = createTaskDraftReducer(null, { type: "open" });
  if (!submitted) {
    throw new Error("Opening must create a draft");
  }
  const dismissed = createTaskDraftReducer(submitted, { type: "close" });
  const reopened = createTaskDraftReducer(dismissed, { type: "open" });
  expect(reopened).not.toBe(submitted);
  expect(
    createTaskDraftReducer(reopened, {
      draftId: submitted,
      type: "created",
    })
  ).toBe(reopened);
});

test("completion closes its own draft and leaves a dismissed dialog closed", () => {
  const draftId = createTaskDraftReducer(null, { type: "open" });
  if (!draftId) {
    throw new Error("Opening must create a draft");
  }
  expect(
    createTaskDraftReducer(draftId, { draftId, type: "created" })
  ).toBeNull();
  expect(createTaskDraftReducer(null, { draftId, type: "created" })).toBeNull();
});
