import {
  type EventEditorState,
  isRecurringEventDraft,
} from "@kompose/state/event-editor";
import { RECURRENCE_SCOPE_OPTIONS } from "@kompose/state/recurrence-scope-options";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import type { useEventEditorFlow } from "@/hooks/use-event-editor-flow";

export function EventScopeDialog({
  flow,
}: {
  flow: ReturnType<typeof useEventEditorFlow>;
}) {
  const { state } = flow;
  if (
    state.status === "closed" ||
    state.status === "editing" ||
    (state.status === "submitting" && state.returnTo !== "scope")
  ) {
    return null;
  }
  const { sessionId } = state;
  const submitting = state.status === "submitting";
  const deleting = state.action === "delete";
  const showScopeOptions = isRecurringEventDraft(state.draft);
  const moveOnly = state.phase === "move";
  const moving =
    !deleting &&
    state.draft.calendar.calendarId !== state.draft.sourceCalendar.calendarId;
  const title = deleting ? "Delete event" : "Save event";
  const description = getScopeDescription(state);
  let confirmLabel = deleting ? "Delete" : "Apply";
  if (moveOnly) {
    confirmLabel = "Retry move";
  }
  const cancel = () => {
    flow.dispatch({ sessionId, type: "cancel-scope" });
  };

  return (
    <View
      accessibilityViewIsModal
      className="absolute inset-0 items-center justify-center bg-black/80 p-6"
    >
      <Pressable
        accessibilityLabel="Back to event"
        className="absolute inset-0"
        disabled={submitting}
        onPress={cancel}
      />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showScopeOptions && !moveOnly ? (
          <View className="mb-4">
            <RadioGroup
              disabled={submitting}
              onValueChange={(scope) => {
                if (
                  scope === "this" ||
                  scope === "all" ||
                  scope === "following"
                ) {
                  flow.dispatch({ scope, sessionId, type: "select-scope" });
                }
              }}
              options={RECURRENCE_SCOPE_OPTIONS.map((option) => ({
                ...option,
                disabled: moving && option.value !== "all",
              }))}
              value={state.scope}
            />
          </View>
        ) : null}
        {state.status === "scope" && state.failed ? (
          <Text accessibilityRole="alert" className="mb-4 text-red-500 text-sm">
            {moveOnly
              ? "The calendar move failed. Retry to finish moving this event."
              : "The request failed. Your changes are kept. Try again."}
          </Text>
        ) : null}
        <View className="flex-row gap-3">
          <Button disabled={submitting} onPress={cancel} variant="outline">
            {moveOnly ? "Close" : "Back"}
          </Button>
          <Button
            disabled={submitting}
            loading={submitting}
            onPress={() => {
              flow.submit(sessionId);
            }}
            style={{ flex: 1 }}
          >
            {confirmLabel}
          </Button>
        </View>
      </Card>
    </View>
  );
}

function getScopeDescription(
  state: Pick<
    Extract<EventEditorState, { status: "scope" }>,
    "phase" | "action" | "draft"
  >
) {
  if (state.phase === "move") {
    return "Changes were saved. The calendar move still needs to finish.";
  }
  if (state.action === "delete") {
    return isRecurringEventDraft(state.draft)
      ? "This is a recurring event. Choose what to delete."
      : "This action cannot be undone.";
  }
  return state.draft.calendar.calendarId ===
    state.draft.sourceCalendar.calendarId
    ? "Choose how broadly to apply these changes."
    : "Moving to a different calendar applies to all events in the series.";
}
