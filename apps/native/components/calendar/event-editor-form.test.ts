/// <reference types="bun" />

import { expect, test } from "bun:test";
import type { EventDraft } from "@kompose/state/event-editor";
import { createFormControl } from "react-hook-form";
import { hydrateEventRecurrence } from "./event-editor-form";

function createForm() {
  const form = createFormControl<EventDraft>({
    defaultValues: { location: "", recurrence: [], summary: "Original" },
  });
  form.register("summary");
  form.register("location");
  form.register("recurrence");
  form.subscribe({
    callback: () => {
      // Assertions read the control directly; the subscription mounts the form.
    },
    formState: { dirtyFields: true, values: true },
  });
  return form;
}

test("late master hydration keeps typed fields and hydrates only recurrence", () => {
  const form = createForm();
  form.setValue("summary", "Typed before master resolved", {
    shouldDirty: true,
  });
  form.setValue("location", "New location", { shouldDirty: true });
  hydrateEventRecurrence(form, ["RRULE:FREQ=WEEKLY"]);
  expect(form.getValues()).toMatchObject({
    location: "New location",
    recurrence: ["RRULE:FREQ=WEEKLY"],
    summary: "Typed before master resolved",
  });
  expect(form.getFieldState("recurrence").isDirty).toBe(false);
});

test("late master hydration preserves edited and explicitly cleared recurrence", () => {
  for (const recurrence of [["RRULE:FREQ=MONTHLY"], []]) {
    const form = createForm();
    hydrateEventRecurrence(form, ["RRULE:FREQ=WEEKLY"]);
    form.setValue("recurrence", recurrence, { shouldDirty: true });
    hydrateEventRecurrence(form, ["RRULE:FREQ=DAILY"]);
    expect(form.getValues("recurrence")).toEqual(recurrence);
  }
});

test("clearing recurrence before the master loads also preserves user intent", () => {
  const form = createForm();
  form.setValue("recurrence", ["RRULE:FREQ=MONTHLY"], {
    shouldDirty: true,
    shouldTouch: true,
  });
  form.setValue("recurrence", [], { shouldDirty: true, shouldTouch: true });
  hydrateEventRecurrence(form, ["RRULE:FREQ=WEEKLY"]);
  expect(form.getValues("recurrence")).toEqual([]);
});
