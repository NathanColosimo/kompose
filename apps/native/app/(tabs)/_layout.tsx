import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

/**
 * Tab layout using NativeTabs for native iOS/Android tab bar experience.
 * Uses SF Symbols for icons on iOS, with automatic Material 3 styling on Android.
 * Each tab wraps a Stack navigator for native header support.
 */
export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(chat)">
        <Label>Chat</Label>
        <Icon sf="bubble.left.and.bubble.right" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(tasks)">
        <Label>Tasks</Label>
        <Icon sf="checkmark.square" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <Label>Calendar</Label>
        <Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Label>Settings</Label>
        <Icon sf="gear" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
