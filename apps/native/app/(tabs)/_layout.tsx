import { NativeTabs } from "expo-router/unstable-native-tabs";

export const unstable_settings = { initialRouteName: "(tasks)" };

/**
 * Tab layout using NativeTabs for native iOS/Android tab bar experience.
 * Uses SF Symbols for icons on iOS, with automatic Material 3 styling on Android.
 * Each tab wraps a Stack navigator for native header support.
 */
export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(tasks)">
        <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checkmark.square" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gear" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
