/**
 * Saves an editor holds open for: it stays open until the save succeeds, so
 * a failure keeps the draft. The failure shows a friendly message, with the
 * server's error kept as its cause for logs and debugging.
 */
export interface HeldSave {
  /** Shown instead of the server's error when the save fails. */
  failureMessage?: string;
}

export const SAVE_FAILURE_MESSAGE =
  "Couldn't save your changes. They're still here.";
export const TASK_CREATE_FAILURE_MESSAGE =
  "Couldn't create the task. It's still in the editor.";
export const EVENT_CREATE_FAILURE_MESSAGE =
  "Couldn't create the event. It's still in the editor.";

export function heldSaveError(error: Error, failureMessage?: string): Error {
  return failureMessage ? new Error(failureMessage, { cause: error }) : error;
}
