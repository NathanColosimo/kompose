"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  applyDesktopCommandBarShortcutPreset,
  type DesktopCommandBarShortcutPresetId,
  desktopCommandBarShortcutPresets,
  getDesktopCommandBarShortcutPresetId,
  setDesktopCommandBarShortcutPresetId,
} from "@/lib/tauri-desktop";

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

  useEffect(() => {
    setIsLoading(true);
    let cancelled = false;
    getDesktopCommandBarShortcutPresetId()
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
  }, [form]);

  const applyForm = form.handleSubmit(async ({ presetId }) => {
    await applyDesktopCommandBarShortcutPreset(presetId);
    await setDesktopCommandBarShortcutPresetId(presetId);
    toast.success("Desktop command bar shortcut updated.");
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
    <Card>
      <CardHeader>
        <CardTitle>Desktop Command Bar Shortcut</CardTitle>
        <CardDescription>
          Pick a global shortcut preset for opening the desktop command bar
          popup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">
            Loading shortcut preference…
          </p>
        ) : (
          <div className="grid gap-2">
            {desktopCommandBarShortcutPresets.map((preset) => {
              const isSelected = preset.id === selectedPresetId;
              return (
                <Button
                  className="justify-between"
                  disabled={form.formState.isSubmitting}
                  key={preset.id}
                  onClick={() => handlePresetChange(preset.id)}
                  type="button"
                  variant={isSelected ? "secondary" : "outline"}
                >
                  <span>{preset.label}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {preset.accelerator}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
