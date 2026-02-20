import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import {
  Modal,
  Pressable,
  TextInput,
  type TextStyle,
  TouchableWithoutFeedback,
  type ViewStyle,
} from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { cn } from "@/lib/utils";

const ModelSelectorContext = createContext<{
  open: boolean;
  onOpenChange: (next: boolean) => void;
} | null>(null);

function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);
  if (!context) {
    throw new Error(
      "ModelSelector components must be used inside <ModelSelector>."
    );
  }
  return context;
}

interface ModelSelectorProps {
  children: ReactNode;
  onOpenChange: (next: boolean) => void;
  open: boolean;
}

/**
 * Root provider for native model selection UI.
 */
export function ModelSelector({
  open,
  onOpenChange,
  children,
}: ModelSelectorProps) {
  return (
    <ModelSelectorContext.Provider value={{ open, onOpenChange }}>
      {children}
    </ModelSelectorContext.Provider>
  );
}

interface ModelSelectorTriggerProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * Trigger that opens the model selector modal.
 */
export function ModelSelectorTrigger({
  children,
  className,
  disabled = false,
}: ModelSelectorTriggerProps) {
  const { onOpenChange } = useModelSelectorContext();
  return (
    <Pressable
      className={cn(
        "flex-row items-center gap-1 rounded-full border border-border bg-card px-2 py-1",
        disabled ? "opacity-50" : "",
        className
      )}
      disabled={disabled}
      onPress={() => onOpenChange(true)}
    >
      {children}
    </Pressable>
  );
}

interface ModelSelectorContentProps {
  children: ReactNode;
  title?: ReactNode;
}

/**
 * Modal body containing model search and options.
 */
export function ModelSelectorContent({
  children,
  title = "Select Model",
}: ModelSelectorContentProps) {
  const { open, onOpenChange } = useModelSelectorContext();
  const borderColor = useColor("border");
  const cardColor = useColor("card");

  const containerStyle: ViewStyle = {
    borderColor,
    backgroundColor: cardColor,
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
      transparent
      visible={open}
    >
      <TouchableWithoutFeedback onPress={() => onOpenChange(false)}>
        <View className="flex-1 items-center justify-end bg-black/40 px-4 pb-8">
          <TouchableWithoutFeedback>
            <View
              className="w-full max-w-xl rounded-2xl border p-3"
              style={containerStyle}
            >
              <Text className="px-1 pb-2 font-semibold text-sm">{title}</Text>
              {children}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

interface ModelSelectorInputProps {
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}

/**
 * Filter input used inside model selector content.
 */
export function ModelSelectorInput({
  value,
  onChangeText,
  placeholder = "Filter models...",
}: ModelSelectorInputProps) {
  const borderColor = useColor("border");
  const backgroundColor = useColor("background");
  const textColor = useColor("text");
  const mutedTextColor = useColor("textMuted");

  const inputStyle: TextStyle = {
    borderColor,
    backgroundColor,
    color: textColor,
  };

  return (
    <TextInput
      className="mb-2 rounded-xl border border-border bg-background px-3 py-2 text-foreground"
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={mutedTextColor}
      style={inputStyle}
      value={value}
    />
  );
}

interface ModelSelectorListProps {
  children: ReactNode;
}

export function ModelSelectorList({ children }: ModelSelectorListProps) {
  return <View className="gap-1">{children}</View>;
}

interface ModelSelectorEmptyProps {
  children: ReactNode;
}

export function ModelSelectorEmpty({ children }: ModelSelectorEmptyProps) {
  return (
    <Text className="px-2 py-3 text-muted-foreground text-sm">{children}</Text>
  );
}

interface ModelSelectorGroupProps {
  children: ReactNode;
  heading?: ReactNode;
}

export function ModelSelectorGroup({
  heading,
  children,
}: ModelSelectorGroupProps) {
  return (
    <View className="gap-1">
      {heading ? (
        <Text className="px-2 py-1 text-muted-foreground text-xs uppercase">
          {heading}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

interface ModelSelectorItemProps {
  children: ReactNode;
  onSelect: () => void;
}

/**
 * Selectable model option row.
 */
export function ModelSelectorItem({
  children,
  onSelect,
}: ModelSelectorItemProps) {
  const { onOpenChange } = useModelSelectorContext();

  return (
    <Pressable
      className="rounded-lg px-2 py-2 active:bg-muted"
      onPress={() => {
        onSelect();
        onOpenChange(false);
      }}
    >
      {children}
    </Pressable>
  );
}

interface ModelSelectorLogoProps {
  className?: string;
  provider: string;
}

/**
 * Small provider badge used in model rows.
 */
export function ModelSelectorLogo({
  provider,
  className,
}: ModelSelectorLogoProps) {
  return (
    <View
      className={cn(
        "h-4 w-4 items-center justify-center rounded-full bg-muted",
        className
      )}
    >
      <Text className="font-semibold text-[10px] text-muted-foreground">
        {provider.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

interface ModelSelectorNameProps {
  children: ReactNode;
  className?: string;
}

export function ModelSelectorName({
  children,
  className,
}: ModelSelectorNameProps) {
  return (
    <Text className={cn("flex-1 text-foreground text-sm", className)}>
      {children}
    </Text>
  );
}
