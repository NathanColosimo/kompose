import type { UpdateScope } from "@kompose/api/routers/task/contract";
import type { TaskFormValues } from "./task-edit-popover";

type TaskEditorPhase =
  | { type: "editing" }
  | { type: "delete" }
  | { type: "scope"; values: TaskFormValues; scope: UpdateScope };

type EditorAction =
  | TaskEditorPhase
  | { type: "select-scope"; scope: UpdateScope };

export function taskEditorPhaseReducer(
  current: TaskEditorPhase,
  action: EditorAction
): TaskEditorPhase {
  if (action.type === "select-scope") {
    return current.type === "scope"
      ? { ...current, scope: action.scope }
      : current;
  }
  if (action.type === "editing") {
    return action;
  }
  return current.type === "editing" ? action : current;
}
