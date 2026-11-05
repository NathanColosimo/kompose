import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  TASK_DELETE_SCOPE_OPTIONS,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import { View } from "react-native";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { RadioGroup } from "@/components/ui/radio";
import type { TaskEditorFlow } from "@/hooks/use-task-editor-flow";

export function TaskScopeDialogs({ flow }: { flow: TaskEditorFlow }) {
  return (
    <>
      <AlertDialog
        confirmText="Apply"
        description="This is a recurring task. Choose how broadly to apply these updates."
        isVisible={flow.scopeDialog === "save"}
        onCancel={flow.close}
        onClose={flow.close}
        onConfirm={flow.confirmScopedSave}
        title="Apply task update"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => flow.setSaveScope(value as UpdateScope)}
            options={TASK_UPDATE_SCOPE_OPTIONS}
            value={flow.saveScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        confirmText="Delete"
        description="This is a recurring task. Choose what to delete."
        isVisible={flow.scopeDialog === "delete"}
        onClose={flow.close}
        onConfirm={flow.confirmScopedDelete}
        title="Delete recurring task"
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => flow.setDeleteScope(value as DeleteScope)}
            options={TASK_DELETE_SCOPE_OPTIONS}
            value={flow.deleteScope}
          />
        </View>
      </AlertDialog>
    </>
  );
}
