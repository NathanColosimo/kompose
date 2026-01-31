import { Redirect, Tabs } from "expo-router";
import { TabBarIcon } from "@/components/tabbar-icon";
import { authClient } from "@/lib/auth-client";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";

export default function TabLayout() {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const { data: session, isPending } = authClient.useSession();

  /**
   * Route gating:
   * Tabs are the "real app". If the user isn't signed in yet, send them back to
   * the Home drawer screen where sign-in/sign-up lives.
   */
  if (isPending) {
    return null;
  }
  if (!session?.user) {
    return <Redirect href="/(drawer)" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.text,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="check-square-o" />
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="calendar" />
          ),
        }}
      />
    </Tabs>
  );
}
