import { onlineManager } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A form's fields, read-only while its save runs: a change made then
 * wouldn't be saved. The fields remount when a save starts, closing any open
 * picker, whose options render in a portal outside the fieldset and would
 * still take a click. Keep form values above this (react-hook-form), so the
 * remount loses nothing.
 *
 * The page under the editor takes no click while the save runs either: one
 * that changed the view (another list, another week) would unmount the
 * editor, and its edits would be gone if the save then failed. Not while
 * offline, though: a save that waits for the connection (a task's does)
 * would hold the whole page until it's back.
 */
export function HeldFieldset({
  children,
  className,
  saving,
}: {
  children: ReactNode;
  className?: string;
  saving: boolean;
}) {
  const online = useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true
  );
  return (
    <fieldset
      className={className}
      disabled={saving}
      key={saving ? "saving" : "editing"}
    >
      {children}
      {saving && online
        ? createPortal(
            // Under popovers and dialogs (z-50), over everything else.
            <div aria-hidden className="fixed inset-0 z-40" />,
            document.body
          )
        : null}
    </fieldset>
  );
}

/**
 * A Save button's label, or "Saving…" while its save runs. Both share one
 * cell, so the button keeps the wider one's width and nothing beside it
 * shifts.
 */
export function SavingLabel({
  children,
  saving,
  savingLabel = "Saving…",
}: {
  children: ReactNode;
  saving: boolean;
  /** What it says while saving: "Deleting…" for a delete. */
  savingLabel?: string;
}) {
  return (
    <span className="grid justify-items-center">
      <span
        className={cn(
          "col-start-1 row-start-1 flex items-center gap-1.5",
          saving && "invisible"
        )}
      >
        {children}
      </span>
      <span className={cn("col-start-1 row-start-1", !saving && "invisible")}>
        {savingLabel}
      </span>
    </span>
  );
}

/**
 * Why a held save failed, beside the editor's Save button: a toast in a
 * corner could land on the editor it's about. It takes focus when it
 * appears, since the fields remounted when the save started and focus was
 * lost; a screen reader reads it then (no alert role, which would read it
 * twice), and Tab carries on from here. Clear `message` when a save starts:
 * focus moves only when it changes, so a repeat of the same failure would
 * otherwise stay unfocused.
 */
export function SaveFailure({
  className,
  message,
}: {
  className?: string;
  message: string | null;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) {
      ref.current?.focus();
    }
  }, [message]);
  return message ? (
    <p
      className={cn("text-destructive text-xs outline-none", className)}
      data-slot="save-failure"
      ref={ref}
      tabIndex={-1}
    >
      {message}
    </p>
  ) : null;
}
