import type {
  DeleteScope,
  TaskSelectDecoded,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { LinkEditedFields } from "./link-metadata";
import {
  getTaskUpdateScopeDecision,
  haveTaskCoreFieldsChanged,
} from "./task-recurrence";

export type TaskDraft = Pick<
  TaskSelectDecoded,
  | "title"
  | "status"
  | "durationMinutes"
  | "dueDate"
  | "startDate"
  | "startTime"
  | "recurrence"
  | "links"
> & {
  description: string;
  /** Fields the user set, which link metadata must not overwrite. */
  linkEditedFields?: LinkEditedFields;
  /** Current text in the link input field (not yet added to links array). */
  linkInput: string;
  tagIds: string[];
};

export type TaskEditorState =
  | { kind: "closed" }
  | { kind: "create"; sessionId: string; initial: TaskDraft }
  | { kind: "edit"; sessionId: string; task: TaskSelectDecoded }
  | {
      kind: "saveScope";
      task: TaskSelectDecoded;
      draft: TaskDraft;
      scope: UpdateScope;
    }
  | { kind: "deleteScope"; task: TaskSelectDecoded; scope: DeleteScope };

type TaskEditorAction =
  | { type: "openCreate"; sessionId: string; initial: TaskDraft }
  | { type: "openEdit"; sessionId: string; task: TaskSelectDecoded }
  | { type: "close" }
  | { type: "save"; draft: TaskDraft }
  | { type: "delete" }
  | { type: "setScope"; scope: UpdateScope | DeleteScope };

export function buildTaskDraft(task: TaskSelectDecoded): TaskDraft {
  return {
    description: task.description ?? "",
    dueDate: task.dueDate,
    durationMinutes: task.durationMinutes,
    linkEditedFields: { durationMinutes: true, title: false },
    linkInput: "",
    links: task.links ?? [],
    recurrence: task.recurrence ?? null,
    startDate: task.startDate,
    startTime: task.startTime,
    status: task.status,
    tagIds: task.tags.map((tag) => tag.id),
    title: task.title,
  };
}

export function canSaveTaskDraft(draft: TaskDraft): boolean {
  return (
    (draft.title.trim().length > 0 || draft.links.length > 0) &&
    draft.durationMinutes > 0
  );
}

export function getTaskDraftUpdateScopeDecision(
  task: TaskSelectDecoded,
  draft: TaskDraft
) {
  return getTaskUpdateScopeDecision({
    hasCoreFieldChanges: haveTaskCoreFieldsChanged({
      next: draft,
      previous: task,
    }),
    isRecurring: task.seriesMasterId !== null,
    isSeriesMaster: task.seriesMasterId === task.id,
    nextRecurrence: draft.recurrence,
    nextTagIds: draft.tagIds,
    previousRecurrence: task.recurrence,
    previousTagIds: task.tags.map((tag) => tag.id),
  });
}

export function taskEditorFlowReducer(
  state: TaskEditorState,
  action: TaskEditorAction
): TaskEditorState {
  switch (action.type) {
    case "openCreate":
      return {
        initial: action.initial,
        kind: "create",
        sessionId: action.sessionId,
      };
    case "openEdit":
      return {
        kind: "edit",
        sessionId: action.sessionId,
        task: action.task,
      };
    case "close":
      return { kind: "closed" };
    case "save": {
      if (
        (state.kind !== "create" && state.kind !== "edit") ||
        !canSaveTaskDraft(action.draft)
      ) {
        return state;
      }
      if (state.kind === "edit") {
        const decision = getTaskDraftUpdateScopeDecision(
          state.task,
          action.draft
        );
        if (decision.action === "prompt") {
          return {
            draft: action.draft,
            kind: "saveScope",
            scope: decision.defaultScope,
            task: state.task,
          };
        }
      }
      return { kind: "closed" };
    }
    case "delete":
      if (state.kind !== "edit") {
        return state;
      }
      return state.task.seriesMasterId
        ? { kind: "deleteScope", scope: "this", task: state.task }
        : { kind: "closed" };
    case "setScope":
      if (state.kind !== "saveScope" && state.kind !== "deleteScope") {
        return state;
      }
      return { ...state, scope: action.scope };
    default:
      throw new Error(`Unknown task editor action: ${action satisfies never}`);
  }
}
