"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import {
  RECURRENCE_SCOPE_OPTIONS,
  type RecurrenceScopeOption,
} from "@kompose/state/recurrence-scope-options";
import { useId } from "react";
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

export function RecurrenceScopeDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onValueChange,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  onConfirm,
  disabledScopes,
  options = RECURRENCE_SCOPE_OPTIONS,
  pending = false,
  scopeDisabled = false,
  error,
}: {
  pending?: boolean;
  scopeDisabled?: boolean;
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  value: RecurrenceScope;
  onValueChange: (value: RecurrenceScope) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  disabledScopes?: Partial<Record<RecurrenceScope, boolean>>;
  options?: readonly RecurrenceScopeOption<RecurrenceScope>[];
}) {
  const idBase = useId();

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!pending) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <RadioGroup
          disabled={pending || scopeDisabled}
          onValueChange={(next) => onValueChange(next as RecurrenceScope)}
          value={value}
        >
          {options.map((opt) => {
            const id = `${idBase}-${opt.value}`;
            const isDisabled = Boolean(
              pending || scopeDisabled || disabledScopes?.[opt.value]
            );
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

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
