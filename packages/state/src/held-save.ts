/**
 * Saves an editor holds open for: it stays open until the save succeeds, so
 * a failure keeps the draft. The failure shows a friendly message, with the
 * server's error kept as its cause for logs and debugging.
 */
export interface HeldSave {
  /** Shown instead of the server's error when the save fails. */
  failureMessage?: string;
  /**
   * The caller reports the failure itself (the web editor shows it beside
   * Save), so no toast lands on top of it.
   */
  quiet?: boolean;
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

/** Report a failed save, unless its editor shows the failure (quiet). */
export function reportHeldSaveFailure(
  notifyError: ((error: Error) => void) | undefined,
  error: Error,
  { failureMessage, quiet }: HeldSave
): void {
  if (!quiet) {
    notifyError?.(heldSaveError(error, failureMessage));
  }
}
