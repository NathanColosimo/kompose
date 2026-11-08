"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import {
  RECURRENCE_SCOPE_OPTIONS,
  type RecurrenceScopeOption,
} from "@kompose/state/recurrence-scope-options";
import { useId, useRef, useState } from "react";
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

export function RecurrenceScopeDialog({
  open,
  onOpenChange,
  title,
  subject,
  description,
  value,
  onValueChange,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
  disabledScopes,
  options = RECURRENCE_SCOPE_OPTIONS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the save changes, in a line. */
  subject?: ScopeDialogSubject;
  description?: string;
  value: RecurrenceScope;
  onValueChange: (value: RecurrenceScope) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  disabledScopes?: Partial<Record<RecurrenceScope, boolean>>;
  options?: readonly RecurrenceScopeOption<RecurrenceScope>[];
}) {
  const idBase = useId();
  // One confirm at a time: a held Cmd+Enter or a double click on Delete
  // would otherwise send the change twice while the first is running.
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const confirm = async () => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="sm:max-w-[420px]"
        // Cmd+Enter confirms the choice, as it saves the editor behind.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!e.repeat) {
              confirm().catch(() => null);
            }
          }
        }}
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
              {description ? (
                <span className="block">{description}</span>
              ) : null}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <RadioGroup
          onValueChange={(next) => onValueChange(next as RecurrenceScope)}
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
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              confirm().catch(() => null);
            }}
            type="button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
