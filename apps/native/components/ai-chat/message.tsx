import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { View } from "@/components/ui/view";
import { cn } from "@/lib/utils";

interface MessageProps {
  from: UIMessage["role"];
  children: ReactNode;
  className?: string;
}

/**
 * Message row wrapper that aligns user bubbles to the right.
 */
export function Message({ from, children, className }: MessageProps) {
  return (
    <View
      className={cn(
        "w-full flex-col gap-2",
        // Stretch assistant rows so reasoning/text blocks have usable width.
        from === "user" ? "items-end" : "items-stretch",
        className
      )}
    >
      {children}
    </View>
  );
}

interface MessageContentProps {
  children: ReactNode;
  className?: string;
  from?: UIMessage["role"];
}

/**
 * Bubble container for message parts.
 */
export function MessageContent({
  children,
  className,
  from = "assistant",
}: MessageContentProps) {
  return (
    <View
      className={cn(
        "max-w-[92%] gap-2 rounded-2xl px-3 py-2",
        from === "user"
          ? "bg-secondary text-foreground"
          : "bg-transparent px-0 py-0",
        className
      )}
    >
      {children}
    </View>
  );
}

interface MessageResponseProps {
  children: ReactNode;
  className?: string;
}

/**
 * Text content block for assistant/user response text.
 */
export function MessageResponse({ children, className }: MessageResponseProps) {
  return (
    <View className={cn("rounded-xl bg-card px-3 py-2", className)}>
      {/* The caller controls formatting; this wrapper only provides visual grouping. */}
      {children}
    </View>
  );
}
