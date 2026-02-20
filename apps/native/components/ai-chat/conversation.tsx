import { ChevronDown } from "lucide-react-native";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { cn } from "@/lib/utils";

interface ConversationProps {
  children: ReactNode;
  className?: string;
}

/**
 * Top-level conversation container.
 * This mirrors the web ai-elements shape while staying RN-native.
 */
export function Conversation({ children, className }: ConversationProps) {
  return <View className={cn("flex-1", className)}>{children}</View>;
}

interface ConversationContentProps {
  children: ReactNode;
  className?: string;
}

/**
 * Conversation content wrapper used around the message list.
 */
export function ConversationContent({
  children,
  className,
}: ConversationContentProps) {
  return <View className={cn("flex-1 gap-3", className)}>{children}</View>;
}

interface ConversationEmptyStateProps {
  description: string;
  icon?: ReactNode;
  title: string;
}

/**
 * Empty state shown when there are no chat messages yet.
 */
export function ConversationEmptyState({
  title,
  description,
  icon,
}: ConversationEmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-6 py-8">
      {icon ? <View className="mb-3">{icon}</View> : null}
      <Text className="text-center font-semibold text-foreground">{title}</Text>
      <Text className="mt-1 text-center text-muted-foreground text-sm">
        {description}
      </Text>
    </View>
  );
}

interface ConversationScrollButtonProps {
  onPress?: () => void;
  visible?: boolean;
}

/**
 * Floating helper button to jump to the bottom of the thread.
 */
export function ConversationScrollButton({
  visible = false,
  onPress,
}: ConversationScrollButtonProps) {
  if (!(visible && onPress)) {
    return null;
  }

  return (
    <View className="absolute right-3 bottom-3 z-20" pointerEvents="box-none">
      <Button
        accessibilityLabel="Scroll to latest message"
        onPress={onPress}
        size="icon"
      >
        <ChevronDown size={16} />
      </Button>
    </View>
  );
}
