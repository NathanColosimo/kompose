import { Brain, ChevronDown, Dot } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { cn } from "@/lib/utils";

const ChainOfThoughtContext = createContext<{
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
} | null>(null);

function useChainOfThought() {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used inside <ChainOfThought>."
    );
  }
  return context;
}

interface ChainOfThoughtProps {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

/**
 * Collapsible container for assistant reasoning blocks.
 */
export function ChainOfThought({
  children,
  defaultOpen = false,
  className,
}: ChainOfThoughtProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contextValue = useMemo(() => ({ isOpen, setIsOpen }), [isOpen]);

  return (
    <ChainOfThoughtContext.Provider value={contextValue}>
      <View className={cn("w-full gap-2", className)}>{children}</View>
    </ChainOfThoughtContext.Provider>
  );
}

interface ChainOfThoughtHeaderProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Header row that toggles reasoning visibility.
 */
export function ChainOfThoughtHeader({
  children,
  className,
}: ChainOfThoughtHeaderProps) {
  const { isOpen, setIsOpen } = useChainOfThought();
  const mutedText = useColor("textMuted");

  return (
    <Pressable
      className={cn("flex-row items-center gap-2 py-1", className)}
      onPress={() => setIsOpen(!isOpen)}
    >
      <Brain color={mutedText} size={14} />
      <Text className="flex-1 text-muted-foreground text-xs" numberOfLines={1}>
        {children ?? "Chain of Thought"}
      </Text>
      <ChevronDown
        color={mutedText}
        size={14}
        style={{ transform: [{ rotate: isOpen ? "180deg" : "0deg" }] }}
      />
    </Pressable>
  );
}

interface ChainOfThoughtContentProps {
  children: ReactNode;
  className?: string;
}

/**
 * Content shown only while the reasoning section is open.
 */
export function ChainOfThoughtContent({
  children,
  className,
}: ChainOfThoughtContentProps) {
  const { isOpen } = useChainOfThought();
  if (!isOpen) {
    return null;
  }
  return <View className={cn("gap-2", className)}>{children}</View>;
}

interface ChainOfThoughtStepProps {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  label: ReactNode;
  status?: "complete" | "active" | "pending";
}

/**
 * Individual step in the reasoning timeline.
 */
export function ChainOfThoughtStep({
  label,
  description,
  status = "complete",
  children,
  className,
}: ChainOfThoughtStepProps) {
  const mutedText = useColor("textMuted");
  const foreground = useColor("text");
  return (
    <View className={cn("flex-row gap-2", className)}>
      <View className="pt-0.5">
        <Dot color={status === "pending" ? mutedText : foreground} size={16} />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-foreground text-xs">{label}</Text>
        {description ? (
          <Text className="text-muted-foreground text-xs">{description}</Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}
