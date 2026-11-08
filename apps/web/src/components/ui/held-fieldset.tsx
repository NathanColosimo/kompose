import type { ReactNode } from "react";

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
