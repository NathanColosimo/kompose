"use client";

import {
  type DesktopCommandBarShortcutPresetId,
  desktopCommandBarShortcutPresets,
} from "@kompose/desktop";
import { Check } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { desktopBridge } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { SettingsRowSkeleton, SettingsSection } from "./settings-section";

interface DesktopShortcutFormValues {
  presetId: DesktopCommandBarShortcutPresetId;
}

export function DesktopShortcutSettings() {
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<DesktopShortcutFormValues>({
    defaultValues: {
      presetId: "cmd_or_ctrl_shift_k",
    },
  });
  const selectedPresetId = form.watch("presetId");

  useMountEffect(() => {
    setIsLoading(true);
    let cancelled = false;
    desktopBridge()
      .getShortcut()
      .then((presetId) => {
        if (cancelled) {
          return;
        }
        form.setValue("presetId", presetId, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      })
      .catch((error) => {
        console.warn(
          "Failed to load desktop command bar shortcut preset.",
          error
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  });

  const applyForm = form.handleSubmit(async ({ presetId }) => {
    await desktopBridge().setShortcut(presetId);
    toast.success("Shortcut updated.");
  });

  const handlePresetChange = (
    nextPresetId: DesktopCommandBarShortcutPresetId
  ) => {
    if (form.formState.isSubmitting || nextPresetId === selectedPresetId) {
      return;
    }

    const previousPresetId = selectedPresetId;
    form.setValue("presetId", nextPresetId, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });

    applyForm().catch((error) => {
      form.setValue("presetId", previousPresetId, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update desktop command bar shortcut."
      );
    });
  };

  return (
    <SettingsSection
      description="Opens the command bar from anywhere on your computer."
      title="Command bar shortcut"
    >
      {isLoading ? (
        <SettingsRowSkeleton />
      ) : (
        <fieldset className="divide-y" disabled={form.formState.isSubmitting}>
          <legend className="sr-only">Command bar shortcut</legend>
          {desktopCommandBarShortcutPresets.map((preset) => {
            const isSelected = preset.id === selectedPresetId;
            return (
              <label
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50 has-disabled:opacity-50"
                key={preset.id}
              >
                <input
                  checked={isSelected}
                  className="sr-only"
                  name="command-bar-shortcut"
                  onChange={() => handlePresetChange(preset.id)}
                  type="radio"
                  value={preset.id}
                />
                <Check
                  className={cn("size-4", isSelected ? "" : "invisible")}
                />
                <span className="flex-1">{preset.label}</span>
                <span className="font-mono text-muted-foreground text-xs">
                  {preset.accelerator}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
    </SettingsSection>
  );
}
