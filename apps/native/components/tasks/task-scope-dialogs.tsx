import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import {
  SCOPE_DIALOG_COPY,
  TASK_DELETE_SCOPE_OPTIONS,
  TASK_UPDATE_SCOPE_OPTIONS,
} from "@kompose/state/recurrence-scope-options";
import { View } from "react-native";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { RadioGroup } from "@/components/ui/radio";
import type { TaskEditorFlow } from "@/hooks/use-task-editor-flow";

/** Each option a 44pt target; the radio itself is 26pt. */
const SCOPE_OPTION_STYLE = { minHeight: 44 } as const;

/**
 * Save and delete scope for a recurring task. Render them inside the
 * editor sheet (its `overlay`): iOS presents a modal only from the one
 * showing, so beside the sheet they'd never appear. Over it, Cancel goes
 * straight back to the editor.
 */
export function TaskScopeDialogs({ flow }: { flow: TaskEditorFlow }) {
  return (
    <>
      <AlertDialog
        // Saving closes the editor and its scope dialog immediately.
        closeOnConfirm={false}
        confirmText="Apply"
        description={SCOPE_DIALOG_COPY.saveTask.description}
        isVisible={flow.scopeDialog === "save"}
        // No onClose: Cancel and a backdrop tap run onCancel, and the flow
        // hides the dialog by `isVisible`.
        onCancel={flow.cancelScopeDialog}
        onConfirm={flow.confirmScopedSave}
        title={SCOPE_DIALOG_COPY.saveTask.title}
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => flow.setSaveScope(value as UpdateScope)}
            optionStyle={SCOPE_OPTION_STYLE}
            options={TASK_UPDATE_SCOPE_OPTIONS}
            value={flow.saveScope}
          />
        </View>
      </AlertDialog>

      <AlertDialog
        // Delete closes the editor, and this dialog with it.
        closeOnConfirm={false}
        confirmText="Delete"
        confirmVariant="destructive"
        description={SCOPE_DIALOG_COPY.deleteTask.description}
        isVisible={flow.scopeDialog === "delete"}
        onCancel={flow.cancelScopeDialog}
        onConfirm={flow.confirmScopedDelete}
        title={SCOPE_DIALOG_COPY.deleteTask.title}
      >
        <View className="mt-2">
          <RadioGroup
            onValueChange={(value) => flow.setDeleteScope(value as DeleteScope)}
            optionStyle={SCOPE_OPTION_STYLE}
            options={TASK_DELETE_SCOPE_OPTIONS}
            value={flow.deleteScope}
          />
        </View>
      </AlertDialog>
    </>
  );
}
