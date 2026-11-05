import { NativeTabs } from "expo-router/native-tabs";

export const unstable_settings = { initialRouteName: "(tasks)" };

// Each tab uses a Stack for headers, which NativeTabs does not render.
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
