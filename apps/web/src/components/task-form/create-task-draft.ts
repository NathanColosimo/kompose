type DraftAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "created"; draftId: object };

/** An opening's object identity owns completion, even after dismiss/reopen. */
export function createTaskDraftReducer(
  current: object | null,
  action: DraftAction
): object | null {
  if (action.type === "open") {
    return {};
  }
  if (action.type === "close") {
    return null;
  }
  return current === action.draftId ? null : current;
}
