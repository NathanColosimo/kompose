import { describe, expect, test } from "bun:test";
import { taskStatusSavePlan } from "./task-recurrence";

const mondays = {
  byDay: ["MO" as const],
  freq: "WEEKLY" as const,
  interval: 1,
};
const tuesdays = {
  byDay: ["TU" as const],
  freq: "WEEKLY" as const,
  interval: 1,
};

describe("taskStatusSavePlan", () => {
  test("saves the status with the edits for this occurrence", () => {
    expect(
      taskStatusSavePlan({
        nextRecurrence: mondays,
        previousRecurrence: mondays,
        scope: "this",
      })
    ).toBe("with-edits");
  });

  test("lets the server keep this occurrence on a pattern change", () => {
    expect(
      taskStatusSavePlan({
        nextRecurrence: tuesdays,
        previousRecurrence: mondays,
        scope: "following",
      })
    ).toBe("with-edits");
  });

  test("sets the status after a following save that keeps the pattern", () => {
    expect(
      taskStatusSavePlan({
        nextRecurrence: mondays,
        previousRecurrence: mondays,
        scope: "following",
      })
    ).toBe("after-edits");
  });
});
