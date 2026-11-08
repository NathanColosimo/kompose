import { createContext, type ReactNode, use } from "react";
import { Image, Pressable, useWindowDimensions, View } from "react-native";
import { Text } from "@/components/ui/text";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** A titled group of settings rows, matching the web settings page. */
export function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <View className="mb-7 gap-2.5">
      <View className="gap-0.5 px-1">
        <Text
          accessibilityRole="header"
          className="font-sans-medium text-base text-foreground"
        >
          {title}
        </Text>
        {description ? (
          <Text className="text-muted-foreground text-sm leading-snug">
            {description}
          </Text>
        ) : null}
      </View>
      <View className="overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </View>
    </View>
  );
}

/**
 * Large text from this scale up moves a row's action under its name, so
 * an email keeps the row's width instead of breaking mid-address.
 */
const STACKED_ROW_FONT_SCALE = 1.3;

/** Whether the row around a RowAction has stacked it under the name. */
const StackedRowContext = createContext(false);

/** One account or app, with its action on the right (or below, at large text). */
export function SettingsRow({
  action,
  detail,
  first = false,
  image,
  name,
}: {
  action?: ReactNode;
  detail?: string | null;
  /** The first row has no divider above it. */
  first?: boolean;
  image?: string | null;
  name: string;
}) {
  const stacked = useWindowDimensions().fontScale >= STACKED_ROW_FONT_SCALE;
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${first ? "" : "border-border border-t"}`}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={{ borderRadius: 16, height: 32, width: 32 }}
        />
      ) : (
        // Decorative (the name is beside it), and a fixed 32pt circle: the
        // initials stay at their size, and VoiceOver skips them.
        <View
          accessibilityElementsHidden
          className="size-8 items-center justify-center rounded-full bg-muted"
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            className="font-sans-medium text-muted-foreground text-xs"
            maxFontSizeMultiplier={1}
          >
            {initials(name) || "?"}
          </Text>
        </View>
      )}
      {/* Names and emails wrap rather than truncate: two similar accounts
          must stay tellable apart beside Unlink, at any text size. */}
      <View className="min-w-0 flex-1">
        <Text className="text-foreground text-sm">{name}</Text>
        {detail ? (
          <Text className="text-muted-foreground text-xs">{detail}</Text>
        ) : null}
        {stacked && action ? (
          // Pulled left by the action's own padding, so its label lines up
          // with the text above.
          <View className="mt-1 -ml-2.5 self-start">
            <StackedRowContext value>{action}</StackedRowContext>
          </View>
        ) : null}
      </View>
      {stacked ? null : action}
    </View>
  );
}

/** A quiet text action for a row, such as Unlink or Sign out. */
export function RowAction({
  accessibilityLabel,
  destructive = false,
  disabled = false,
  label,
  onPress,
}: {
  accessibilityLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const stacked = use(StackedRowContext);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      // Inline, a fixed width keeps "Unlink" and "Unlinking…" the same size;
      // stacked under the name, the label starts where the text does.
      className={`rounded-md px-2.5 py-1.5 active:bg-muted ${stacked ? "items-start" : "min-w-24 items-center"} ${disabled ? "opacity-50" : ""}`}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
    >
      <Text
        className={`text-sm ${destructive ? "text-destructive" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Plain text inside a section, for empty and loading states. */
export function SettingsNote({
  children,
  first = false,
}: {
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <Text
      className={`px-4 py-3 text-muted-foreground text-sm ${first ? "" : "border-border border-t"}`}
    >
      {children}
    </Text>
  );
}
