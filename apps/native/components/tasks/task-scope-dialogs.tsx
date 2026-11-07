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

function noop() {
  // Intentionally empty: see TaskSaveScopeDialog's onClose.
}

/**
 * Save scope for a recurring task. Render it inside the editor sheet: iOS
 * presents a modal from the one showing, not beside it, and this opens over
 * the editor so Cancel goes straight back to it.
 */
export function TaskSaveScopeDialog({ flow }: { flow: TaskEditorFlow }) {
  return (
    <AlertDialog
      closeOnConfirm={false}
      confirmText="Apply"
      description="This is a recurring task. Choose how broadly to apply these updates."
      isVisible={flow.scopeDialog === "save"}
      // Over the editor: Cancel goes back to it, edits kept. After Apply
      // the flow hides this dialog itself (it may be saving).
      onCancel={flow.cancelScopedSave}
      // Cancel and a backdrop tap already run onCancel. The dialog's close
      // after its fade has nothing left to do, and must not clear a save
      // started again meanwhile.
      onClose={noop}
      onConfirm={flow.confirmScopedSave}
      pending={flow.isSavingStatus}
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
  );
}

/** Delete scope for a recurring task (the editor closes before it opens). */
export function TaskDeleteScopeDialog({ flow }: { flow: TaskEditorFlow }) {
  return (
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
  );
}
