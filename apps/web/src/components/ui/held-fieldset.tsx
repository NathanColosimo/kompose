import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A form's fields, read-only while its save runs: a change made then
 * wouldn't be saved. The fields remount when a save starts, closing any open
 * picker, whose options render in a portal outside the fieldset and would
 * still take a click. Keep form values above this (react-hook-form), so the
 * remount loses nothing.
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
  return (
    <fieldset
      className={className}
      disabled={saving}
      key={saving ? "saving" : "editing"}
    >
      {children}
    </fieldset>
  );
}

/**
 * Why a held save failed, beside the editor's Save button: a toast in a
 * corner could land on the editor it's about. It takes focus when it
 * appears, since the fields remounted when the save started and focus was
 * lost; a screen reader reads it, and Tab carries on from here.
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
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      {message}
    </p>
  ) : null;
}
