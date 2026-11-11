"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import type { RecurrenceScopeOption } from "@kompose/state/recurrence-scope-options";
import { useMutation } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/** A moved event and its new time: "Retro" → "Mon, Nov 9 · 4 – 4:45 PM". */
export interface ScopeDialogSubject {
  /** It moved (a drop), rather than changing length (a resize). */
  moved: boolean;
  name: string;
  when: string;
}

/** Asks which occurrences a change applies to; `S` is the scopes offered. */
export function RecurrenceScopeDialog<S extends RecurrenceScope>({
  open,
  onOpenChange,
  title,
  subject,
  description,
  value,
  onValueChange,
  confirmLabel = "Save",
  pendingLabel = "Saving…",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
  disabledScopes,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the save changes, in a line. */
  subject?: ScopeDialogSubject;
  description?: string;
  value: S;
  onValueChange: (value: S) => void;
  confirmLabel?: string;
  /** The confirm button's words while it runs: "Deleting…". */
  pendingLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  disabledScopes?: Partial<Record<S, boolean>>;
  options: readonly RecurrenceScopeOption<S>[];
}) {
  const idBase = useId();
  // One confirm at a time: a held Cmd+Enter or a double click on Delete
  // would otherwise send the change twice while the first is running.
  const pendingRef = useRef(false);
  const confirmation = useMutation({
    networkMode: "always",
    mutationFn: async () => onConfirm(),
    onSuccess: () => onOpenChange(false),
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  const pending = confirmation.isPending;
  const chosenOff = Boolean(disabledScopes?.[value]);
  const confirm = () => {
    if (pendingRef.current || chosenOff) {
      return;
    }
    pendingRef.current = true;
    confirmation.mutate();
  };
  // Keep the choice available for a retry after a failed confirmation.
  const requestOpenChange = (next: boolean) => {
    if (next || !pendingRef.current) {
      confirmation.reset();
      onOpenChange(next);
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="sm:max-w-[420px]"
        // Cmd+Enter confirms the choice, as it saves the editor behind.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!e.repeat) {
              confirm();
            }
          }
        }}
        // Its own close button, which shows it does nothing while a
        // confirm runs, as Cancel does.
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* What's being saved, when the dialog opens away from its editor
              (a drop on the grid): "Retro → Mon, Nov 9 · 4 – 4:45 PM". Part
              of the description, so a screen reader says it too. */}
          {subject || description ? (
            <DialogDescription className="space-y-1">
              {subject ? (
                <span className="block font-medium text-foreground">
                  {subject.name}
                  {/* Read as "Retro, moved to Mon, Nov 9…" (or "now", for a
                      resize), not "right arrow". */}
                  <span aria-hidden> → </span>
                  <span className="sr-only">
                    , {subject.moved ? "moved to" : "now"}{" "}
                  </span>
                  {subject.when}
                </span>
              ) : null}
              {/* Announce changes while the series loads. */}
              {description ? (
                <span aria-live="polite" className="block">
                  {description}
                </span>
              ) : null}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {/* Read-only while a confirm runs, so the choice shown is the one
            being sent. Not disabled, which would drop focus. */}
        <RadioGroup
          aria-readonly={pending || undefined}
          className={cn(pending && "opacity-60")}
          onValueChange={(next) => {
            if (pendingRef.current) {
              return;
            }
            // The radio group gives a string; pass on the option it names.
            const picked = options.find((opt) => opt.value === next);
            if (picked) {
              onValueChange(picked.value);
            }
          }}
          value={value}
        >
          {options.map((opt) => {
            const id = `${idBase}-${opt.value}`;
            const isDisabled = Boolean(disabledScopes?.[opt.value]);
            return (
              <Label
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3",
                  value === opt.value ? "bg-muted" : "",
                  isDisabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
                )}
                htmlFor={id}
                key={opt.value}
              >
                <RadioGroupItem
                  // A circle that stands out on the paper (3:1), dimmed
                  // once with its row when off, not twice.
                  className="border-muted-foreground disabled:opacity-100"
                  disabled={isDisabled}
                  id={id}
                  value={opt.value}
                />
                <span className="text-sm">{opt.label}</span>
              </Label>
            );
          })}
        </RadioGroup>

        <DialogFooter>
          <Button
            aria-disabled={pending || undefined}
            className="aria-disabled:opacity-50"
            onClick={() => {
              if (pendingRef.current) {
                return;
              }
              onCancel?.();
              requestOpenChange(false);
            }}
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          {/* Not disabled while it runs, which would drop focus to the
              page; `confirm` ignores a second press. */}
          <Button
            aria-disabled={pending || undefined}
            disabled={chosenOff}
            onClick={() => {
              confirm();
            }}
            type="button"
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
        <Button
          aria-disabled={pending || undefined}
          className="absolute top-2 right-2 aria-disabled:opacity-50"
          onClick={() => requestOpenChange(false)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
