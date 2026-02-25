import type { ToolPart } from "@kompose/state/ai-message-utils";
import {
  CheckCircle,
  ChevronDown,
  Circle,
  Clock,
  Wrench,
  XCircle,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView } from "react-native";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { cn } from "@/lib/utils";

const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export type { ToolPart };

// ---------------------------------------------------------------------------
// Collapsible context (mirrors ChainOfThought pattern)
// ---------------------------------------------------------------------------

const ToolContext = createContext<{
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
} | null>(null);

function useTool() {
  const context = useContext(ToolContext);
  if (!context) {
    throw new Error("Tool sub-components must be used inside <Tool>.");
  }
  return context;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const STATUS_ICON_SIZE = 10;

function StatusIcon({ state }: { state: ToolPart["state"] }) {
  const yellow = useColor("yellow");
  const blue = useColor("blue");
  const green = useColor("green");
  const orange = useColor("orange");
  const red = useColor("red");
  const muted = useColor("textMuted");

  switch (state) {
    case "approval-requested":
      return <Clock color={yellow} size={STATUS_ICON_SIZE} />;
    case "approval-responded":
      return <CheckCircle color={blue} size={STATUS_ICON_SIZE} />;
    case "input-available":
      return <Clock color={muted} size={STATUS_ICON_SIZE} />;
    case "input-streaming":
      return <Circle color={muted} size={STATUS_ICON_SIZE} />;
    case "output-available":
      return <CheckCircle color={green} size={STATUS_ICON_SIZE} />;
    case "output-denied":
      return <XCircle color={orange} size={STATUS_ICON_SIZE} />;
    case "output-error":
      return <XCircle color={red} size={STATUS_ICON_SIZE} />;
  }
}

// ---------------------------------------------------------------------------
// Tool (collapsible wrapper)
// ---------------------------------------------------------------------------

interface ToolProps {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

export function Tool({ children, defaultOpen = false, className }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contextValue = useMemo(() => ({ isOpen, setIsOpen }), [isOpen]);
  const borderColor = useColor("border");

  return (
    <ToolContext.Provider value={contextValue}>
      <View
        className={cn("mb-2 w-full rounded-lg", className)}
        style={{ borderWidth: 1, borderColor }}
      >
        {children}
      </View>
    </ToolContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ToolHeader
// ---------------------------------------------------------------------------

interface ToolHeaderProps {
  state: ToolPart["state"];
  title: string;
}

export function ToolHeader({ state, title }: ToolHeaderProps) {
  const { isOpen, setIsOpen } = useTool();
  const mutedText = useColor("textMuted");

  return (
    <Pressable
      className="flex-row items-center gap-1.5 px-2 py-1.5"
      onPress={() => setIsOpen(!isOpen)}
    >
      <Wrench color={mutedText} size={12} />
      <Text className="flex-1 font-medium text-xs" numberOfLines={1}>
        {title}
      </Text>
      <Badge
        style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}
        textStyle={{ fontSize: 10 }}
        variant="secondary"
      >
        <View className="flex-row items-center gap-1">
          <StatusIcon state={state} />
          <Text className="text-secondary-foreground" style={{ fontSize: 10 }}>
            {statusLabels[state]}
          </Text>
        </View>
      </Badge>
      <ChevronDown
        color={mutedText}
        size={12}
        style={{ transform: [{ rotate: isOpen ? "180deg" : "0deg" }] }}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ToolContent
// ---------------------------------------------------------------------------

interface ToolContentProps {
  children: ReactNode;
  className?: string;
}

export function ToolContent({ children, className }: ToolContentProps) {
  const { isOpen } = useTool();
  if (!isOpen) {
    return null;
  }
  return <View className={cn("gap-2 px-2 pb-2", className)}>{children}</View>;
}

// ---------------------------------------------------------------------------
// ToolInput — formatted JSON parameters
// ---------------------------------------------------------------------------

interface ToolInputProps {
  className?: string;
  input: ToolPart["input"];
}

export function ToolInput({ input, className }: ToolInputProps) {
  if (input === undefined) {
    return null;
  }

  return (
    <View className={cn("gap-1", className)}>
      <Text className="font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
        Parameters
      </Text>
      <ScrollView
        className="rounded-md bg-muted/50"
        contentContainerStyle={{ padding: 8 }}
        horizontal
      >
        <Text
          className="text-foreground"
          style={{ fontSize: 11, fontFamily: MONO_FONT }}
        >
          {JSON.stringify(input, null, 2)}
        </Text>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ToolOutput — result or error display
// ---------------------------------------------------------------------------

interface ToolOutputProps {
  className?: string;
  errorText: ToolPart["errorText"];
  output: ToolPart["output"];
}

export function ToolOutput({ output, errorText, className }: ToolOutputProps) {
  if (!(output || errorText)) {
    return null;
  }

  const displayText =
    typeof output === "object" && output !== null
      ? JSON.stringify(output, null, 2)
      : typeof output === "string"
        ? output
        : String(output ?? "");

  return (
    <View className={cn("gap-1", className)}>
      <Text className="font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
        {errorText ? "Error" : "Result"}
      </Text>
      <ScrollView
        className={cn(
          "rounded-md",
          errorText ? "bg-destructive/10" : "bg-muted/50"
        )}
        contentContainerStyle={{ padding: 8 }}
        horizontal
      >
        {errorText ? (
          <Text className="text-destructive" style={{ fontSize: 11 }}>
            {errorText}
          </Text>
        ) : (
          <Text
            className="text-foreground"
            style={{ fontSize: 11, fontFamily: MONO_FONT }}
          >
            {displayText}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
