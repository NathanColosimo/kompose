import type { ReactNode } from "react";
import { Image, Pressable, View } from "react-native";
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
        <Text className="font-sans-medium text-base text-foreground">
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

/** One account or app, with its action on the right. */
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
        <View className="size-8 items-center justify-center rounded-full bg-muted">
          <Text className="font-sans-medium text-muted-foreground text-xs">
            {initials(name) || "?"}
          </Text>
        </View>
      )}
      <View className="min-w-0 flex-1">
        <Text className="text-foreground text-sm" numberOfLines={1}>
          {name}
        </Text>
        {detail ? (
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {action}
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
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      className={`min-w-24 items-center rounded-md px-2.5 py-1.5 active:bg-muted ${disabled ? "opacity-50" : ""}`}
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
