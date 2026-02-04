"use client";

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

export type RecurrenceScopeValue = "this" | "all" | "following";

interface RecurrenceScopeOption {
  value: RecurrenceScopeValue;
  label: string;
}

export const RECURRENCE_SCOPE_OPTIONS: RecurrenceScopeOption[] = [
  { value: "this", label: "Only this occurrence" },
  { value: "all", label: "Entire series" },
  { value: "following", label: "This and following" },
];

export function RecurrenceScopeDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onValueChange,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
  disabledScopes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  value: RecurrenceScopeValue;
  onValueChange: (value: RecurrenceScopeValue) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  disabledScopes?: Partial<Record<RecurrenceScopeValue, boolean>>;
}) {
  const idBase = useId();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <RadioGroup
          onValueChange={(next) => onValueChange(next as RecurrenceScopeValue)}
          value={value}
        >
          {RECURRENCE_SCOPE_OPTIONS.map((opt) => {
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
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
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
