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

/** Which occurrences of a recurring task a save applies to. */
export function TaskSaveScopeDialog({
  isVisible,
  onCancel,
  onConfirm,
  onScopeChange,
  scope,
}: {
  isVisible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onScopeChange: (scope: UpdateScope) => void;
  scope: UpdateScope;
}) {
  return (
    <AlertDialog
      // The caller hides it by `isVisible` once the save is sent.
      closeOnConfirm={false}
      confirmText="Apply"
      description={SCOPE_DIALOG_COPY.saveTask.description}
      isVisible={isVisible}
      // No onClose: Cancel and a backdrop tap run onCancel.
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={SCOPE_DIALOG_COPY.saveTask.title}
    >
      <View className="mt-2">
        <RadioGroup
          onValueChange={(value) => onScopeChange(value as UpdateScope)}
          optionStyle={SCOPE_OPTION_STYLE}
          options={TASK_UPDATE_SCOPE_OPTIONS}
          value={scope}
        />
      </View>
    </AlertDialog>
  );
}

/**
 * Save and delete scope for a recurring task. Render them inside the
 * editor sheet (its `overlay`): iOS presents a modal only from the one
 * showing, so beside the sheet they'd never appear. Over it, Cancel goes
 * straight back to the editor.
 */
export function TaskScopeDialogs({ flow }: { flow: TaskEditorFlow }) {
  return (
    <>
      <TaskSaveScopeDialog
        isVisible={flow.scopeDialog === "save"}
        onCancel={flow.cancelScopeDialog}
        onConfirm={flow.confirmScopedSave}
        onScopeChange={flow.setSaveScope}
        scope={flow.saveScope}
      />

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
