import type { LanguageModelUsage } from "ai";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { cn } from "@/lib/utils";

interface ContextValue {
  isOpen: boolean;
  maxTokens: number;
  modelId?: string;
  setIsOpen: (value: boolean) => void;
  usage?: LanguageModelUsage;
  usedTokens: number;
}

const ContextUsageContext = createContext<ContextValue | null>(null);

function useContextUsage() {
  const context = useContext(ContextUsageContext);
  if (!context) {
    throw new Error("Context components must be used inside <Context>.");
  }
  return context;
}

interface ContextProps {
  children: ReactNode;
  maxTokens: number;
  modelId?: string;
  usage?: LanguageModelUsage;
  usedTokens: number;
}

/**
 * Shared provider for context usage controls and readouts.
 */
export function Context({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  children,
}: ContextProps) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo(
    () => ({ usedTokens, maxTokens, usage, modelId, isOpen, setIsOpen }),
    [isOpen, maxTokens, modelId, usage, usedTokens]
  );

  return (
    <ContextUsageContext.Provider value={value}>
      {children}
    </ContextUsageContext.Provider>
  );
}

interface ContextTriggerProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Compact trigger that toggles the expanded context details.
 */
export function ContextTrigger({ className, children }: ContextTriggerProps) {
  const { usedTokens, maxTokens, isOpen, setIsOpen } = useContextUsage();
  const ratio = maxTokens > 0 ? usedTokens / maxTokens : 0;
  const percent = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(ratio);

  return (
    <Pressable
      className={cn(
        "h-8 flex-row items-center gap-2 rounded-full border border-border px-3",
        className
      )}
      onPress={() => setIsOpen(!isOpen)}
    >
      {children ?? (
        <>
          <Text className="text-muted-foreground text-xs">{percent}</Text>
          <View className="h-2 w-2 rounded-full bg-muted-foreground" />
        </>
      )}
    </Pressable>
  );
}

interface ContextContentProps {
  children: ReactNode;
  className?: string;
}

/**
 * Expanded context details region.
 */
export function ContextContent({ children, className }: ContextContentProps) {
  const { isOpen } = useContextUsage();
  if (!isOpen) {
    return null;
  }
  return (
    <View
      className={cn(
        "mt-2 overflow-hidden rounded-xl border border-border",
        className
      )}
    >
      {children}
    </View>
  );
}

interface SectionProps {
  children: ReactNode;
  className?: string;
}

export function ContextContentHeader({ children, className }: SectionProps) {
  return <View className={cn("gap-2 p-3", className)}>{children}</View>;
}

export function ContextContentBody({ children, className }: SectionProps) {
  return (
    <View className={cn("gap-2 border-border border-t p-3", className)}>
      {children}
    </View>
  );
}

export function ContextContentFooter({ children, className }: SectionProps) {
  return (
    <View className={cn("gap-2 border-border border-t bg-card p-3", className)}>
      {children}
    </View>
  );
}

interface ContextUsageRowProps {
  label: string;
  value: number;
}

function ContextUsageRow({ label, value }: ContextUsageRowProps) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-muted-foreground text-xs">{label}</Text>
      <Text className="font-medium text-xs">
        {value.toLocaleString("en-US")}
      </Text>
    </View>
  );
}

/**
 * Input token usage row.
 */
export function ContextInputUsage() {
  const { usage } = useContextUsage();
  return (
    <ContextUsageRow label="Input tokens" value={usage?.inputTokens ?? 0} />
  );
}

/**
 * Output token usage row.
 */
export function ContextOutputUsage() {
  const { usage } = useContextUsage();
  return (
    <ContextUsageRow label="Output tokens" value={usage?.outputTokens ?? 0} />
  );
}

/**
 * Reasoning token usage row.
 */
export function ContextReasoningUsage() {
  const { usage } = useContextUsage();
  return (
    <ContextUsageRow
      label="Reasoning tokens"
      value={usage?.reasoningTokens ?? 0}
    />
  );
}
