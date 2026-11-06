import { expect, test } from "bun:test";
import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { createStore } from "jotai";
import { selectTaskOpenRequestAtom } from "./command-bar";

test("only the matching task and surface receive open requests", () => {
  const store = createStore();
  const calendarTask = selectTaskOpenRequestAtom("task-a", "calendar");
  const sidebarTask = selectTaskOpenRequestAtom("task-a", "sidebar");
  const otherTask = selectTaskOpenRequestAtom("task-b", "calendar");
  let calendarUpdates = 0;
  let sidebarUpdates = 0;
  let otherUpdates = 0;
  const unsubscribe = [
    store.sub(calendarTask, () => {
      calendarUpdates += 1;
    }),
    store.sub(sidebarTask, () => {
      sidebarUpdates += 1;
    }),
    store.sub(otherTask, () => {
      otherUpdates += 1;
    }),
  ];
  const request = {
    requestId: "open-a",
    target: "calendar" as const,
    taskId: "task-a",
  };
  store.set(commandBarTaskOpenRequestAtom, request);
  expect(store.get(calendarTask)).toBe(request);
  expect(store.get(sidebarTask)).toBeNull();
  expect(store.get(otherTask)).toBeNull();
  store.set(commandBarTaskOpenRequestAtom, null);
  expect(calendarUpdates).toBe(2);
  expect(sidebarUpdates).toBe(0);
  expect(otherUpdates).toBe(0);
  for (const stop of unsubscribe) {
    stop();
  }
});
