import type { EventDraft } from "@kompose/state/event-editor";
import type { UseFormReturn } from "react-hook-form";

type RecurrenceForm = Pick<
  UseFormReturn<EventDraft>,
  "getFieldState" | "getValues" | "resetField"
>;

export function hydrateEventRecurrence(
  form: RecurrenceForm,
  masterRecurrence?: string[]
) {
  const field = form.getFieldState("recurrence");
  if (
    !masterRecurrence?.length ||
    field.isDirty ||
    field.isTouched ||
    form.getValues("recurrence").length > 0
  ) {
    return;
  }
  // Make the loaded rule this field's baseline, so clearing it counts as an edit.
  form.resetField("recurrence", { defaultValue: masterRecurrence });
}
