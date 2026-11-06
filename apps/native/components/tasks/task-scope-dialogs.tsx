import {
  TASK_DELETE_SCOPE_OPTIONS,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import { View } from "react-native";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { RadioGroup } from "@/components/ui/radio";
import type { TaskEditorFlow } from "@/hooks/use-task-editor-flow";

export function TaskScopeDialogs({ flow }: { flow: TaskEditorFlow }) {
  const { state } = flow;
  if (state.kind !== "saveScope" && state.kind !== "deleteScope") {
    return null;
  }
  const isSave = state.kind === "saveScope";

  return (
    <AlertDialog
      confirmText={isSave ? "Apply" : "Delete"}
      description={
        isSave
          ? "This is a recurring task. Choose how broadly to apply these updates."
          : "This is a recurring task. Choose what to delete."
      }
      isVisible
      onCancel={flow.close}
      onClose={flow.close}
      onConfirm={isSave ? flow.confirmScopedSave : flow.confirmScopedDelete}
      title={isSave ? "Apply task update" : "Delete recurring task"}
    >
      <View className="mt-2">
        <RadioGroup
          onValueChange={(value) => {
            if (value === "this" || value === "following") {
              flow.setScope(value);
            }
          }}
          options={
            isSave ? TASK_UPDATE_SCOPE_OPTIONS : TASK_DELETE_SCOPE_OPTIONS
          }
          value={state.scope}
        />
      </View>
    </AlertDialog>
  );
}
