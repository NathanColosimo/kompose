/**
 * Saves an editor holds open for: it stays open until the save succeeds, so
 * a failure keeps the draft. The failure shows a friendly message, with the
 * server's error kept as its cause for logs and debugging.
 */
export interface HeldSave {
  /** Shown instead of the server's error when the save fails. */
  failureMessage?: string;
}

/**
 * The network mode of a write an editor can hold open for: it runs at once,
 * online or not. By default a write made offline waits for the connection,
 * and the editor, held until its save settles, would wait with it. This
 * way it fails and the editor keeps the draft.
 */
export const HELD_WRITE_NETWORK_MODE = "always" as const;

export const SAVE_FAILURE_MESSAGE =
  "Couldn't save your changes. They're still here.";
export const TASK_CREATE_FAILURE_MESSAGE =
  "Couldn't create the task. It's still in the editor.";
export const EVENT_CREATE_FAILURE_MESSAGE =
  "Couldn't create the event. It's still in the editor.";

/** Report a failed save through the app's error toast. */
export function reportHeldSaveFailure(
  notifyError: ((error: Error) => void) | undefined,
  error: Error,
  { failureMessage }: HeldSave
): void {
  notifyError?.(
    failureMessage ? new Error(failureMessage, { cause: error }) : error
  );
}
