import { expect, test } from "bun:test";
import type { DesktopTaskSelection } from "@kompose/desktop";
import {
  type PopupState,
  reducePopup,
  reduceTaskDelivery,
  type TaskDeliveryState,
} from "./window-state";

test("two shortcut presses before first paint leave the popup hidden", () => {
  let state: PopupState = { desired: "hidden", kind: "loading" };
  state = reducePopup(state, "toggle");
  state = reducePopup(state, "toggle");
  state = reducePopup(state, "ready");
  expect(state).toEqual({ desired: "hidden", kind: "ready" });
});

test("dismissing before first paint cancels the requested popup", () => {
  let state: PopupState = { desired: "hidden", kind: "loading" };
  state = reducePopup(state, "toggle");
  state = reducePopup(state, "hide");
  expect(reducePopup(state, "ready").desired).toBe("hidden");
});

test("a requested popup opens on first paint and can reopen after dismissal", () => {
  let state: PopupState = { desired: "hidden", kind: "loading" };
  state = reducePopup(state, "toggle");
  expect(reducePopup(state, "ready")).toEqual({
    desired: "shown",
    kind: "ready",
  });
  state = reducePopup(state, "ready");
  state = reducePopup(state, "hide");
  expect(reducePopup(state, "toggle")).toEqual({
    desired: "shown",
    kind: "ready",
  });
});

const selection: DesktopTaskSelection = {
  requestId: "request-1",
  sidebarView: "inbox",
  target: "sidebar",
  taskId: "task-1",
};

test("a task waits through late hydration and is delivered once subscribed", () => {
  const queued = reduceTaskDelivery(
    { pending: null, ready: false },
    { kind: "request", selection }
  );
  expect(queued.deliver).toBeNull();
  expect(queued.state.pending).toEqual(selection);
  const subscribed = reduceTaskDelivery(queued.state, {
    kind: "subscription",
    ready: true,
  });
  expect(subscribed.deliver).toEqual(selection);
  expect(subscribed.state.pending).toBeNull();
  expect(
    reduceTaskDelivery(subscribed.state, { kind: "subscription", ready: true })
      .deliver
  ).toBeNull();
});

test("navigation to an offline page retains the task until the app subscribes again", () => {
  const navigated = reduceTaskDelivery(
    { pending: null, ready: true },
    { kind: "navigate" }
  );
  const queued = reduceTaskDelivery(navigated.state, {
    kind: "request",
    selection,
  });
  const retried = reduceTaskDelivery(queued.state, { kind: "navigate" });
  expect(retried.deliver).toBeNull();
  expect(retried.state.pending).toEqual(selection);
  expect(
    reduceTaskDelivery(retried.state, { kind: "subscription", ready: true })
      .deliver
  ).toEqual(selection);
});

test("tasks arriving during subscription cleanup wait for the next subscriber", () => {
  const unsubscribed = reduceTaskDelivery(
    { pending: null, ready: true },
    { kind: "subscription", ready: false }
  );
  const queued = reduceTaskDelivery(unsubscribed.state, {
    kind: "request",
    selection,
  });
  expect(queued.deliver).toBeNull();
  expect(
    reduceTaskDelivery(queued.state, { kind: "subscription", ready: true })
      .deliver
  ).toEqual(selection);
});

test("only the latest queued selection is opened; subscribed requests deliver immediately", () => {
  let state: TaskDeliveryState = { pending: null, ready: false };
  state = reduceTaskDelivery(state, { kind: "request", selection }).state;
  const latest = { ...selection, requestId: "request-2", taskId: "task-2" };
  state = reduceTaskDelivery(state, {
    kind: "request",
    selection: latest,
  }).state;
  const subscribed = reduceTaskDelivery(state, {
    kind: "subscription",
    ready: true,
  });
  expect(subscribed.deliver).toEqual(latest);
  const immediate = reduceTaskDelivery(subscribed.state, {
    kind: "request",
    selection,
  });
  expect(immediate.deliver).toEqual(selection);
  expect(immediate.state.pending).toBeNull();
});
