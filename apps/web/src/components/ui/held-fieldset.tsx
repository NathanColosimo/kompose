import { onlineManager } from "@tanstack/react-query";
import {
  type ReactNode,
  type SyntheticEvent,
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
 * The page under the editor takes no click or key while the save runs
 * either: one that changed the view (another list, another week) would
 * unmount the editor, and its edits would be gone if the save then failed.
 * Tab still moves focus, so it can come back to the editor. Not while
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
  const held = saving && online;
  useEffect(() => {
    if (!held) {
      return;
    }
    // Enter or Space on a button under the editor, reached with Tab, would
    // press it. Keys inside the editor and its dialogs go through.
    const blockKeyUnderEditor = (event: KeyboardEvent) => {
      const inEditor =
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"]') !== null;
      if (event.key === "Tab" || inEditor) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", blockKeyUnderEditor, true);
    return () =>
      document.removeEventListener("keydown", blockKeyUnderEditor, true);
  }, [held]);
  return (
    <fieldset
      className={className}
      disabled={saving}
      key={saving ? "saving" : "editing"}
    >
      {children}
      {held
        ? createPortal(
            // Under popovers and dialogs (z-50), over everything else. React
            // bubbles a portal's events to its React parents, so a press here
            // would reach the draggable block or row the editor opened from
            // and start dragging it: it stops here.
            <div
              aria-hidden
              className="fixed inset-0 z-40"
              data-page-held
              onClick={stopHere}
              onMouseDown={stopHere}
              onPointerDown={stopHere}
              onTouchStart={stopHere}
            />,
            document.body
          )
        : null}
    </fieldset>
  );
}

function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Whether an editor is holding the page for its save (`HeldFieldset`): the
 * shortcuts that change the view wait too, as its clicks do.
 */
export function pageIsHeld(): boolean {
  return document.querySelector("[data-page-held]") !== null;
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
