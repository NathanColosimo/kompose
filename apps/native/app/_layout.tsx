import "../global.css";

import { StateProvider } from "@kompose/state/state-provider";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Platform, ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SignIn } from "@/components/sign-in";
import { Text } from "@/components/ui/text";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { authClient } from "@/lib/auth-client";
import {
  ColorSchemeProvider,
  useColorScheme,
} from "@/lib/color-scheme-context";
import { createSecureStoreAdapter } from "@/lib/state-storage";
import { NAV_THEME } from "@/lib/theme";
import { themeVars } from "@/lib/theme-vars";
import { orpc, queryClient } from "@/utils/orpc";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

/**
 * Inner layout that consumes the color scheme context and auth state.
 * Shows sign-in screen when not authenticated.
 */
function RootLayoutContent() {
  const { colorScheme, isDarkColorScheme, isLoaded } = useColorScheme();
  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();

  // Update Android nav bar when color scheme changes
  React.useEffect(() => {
    if (Platform.OS === "android") {
      setAndroidNavigationBar(colorScheme);
    }
  }, [colorScheme]);

  // Wait for theme preference and session to load
  if (!isLoaded || isSessionLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Get the current theme for navigation styling
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  // Show sign-in screen when not authenticated
  if (!session?.user) {
    return (
      <>
        <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
        <GestureHandlerRootView
          className={isDarkColorScheme ? "dark flex-1" : "flex-1"}
        >
          <View
            className="flex-1"
            style={isDarkColorScheme ? themeVars.dark : themeVars.light}
          >
            <ScrollView
              className="flex-1 bg-background"
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: "center",
                padding: 24,
              }}
              contentInsetAdjustmentBehavior="automatic"
            >
              <View className="gap-6">
                <View className="items-center gap-2">
                  <Text className="font-bold text-2xl text-foreground">
                    Welcome to Kompose
                  </Text>
                  <Text className="text-center text-muted-foreground">
                    Sign in to access your calendar and tasks
                  </Text>
                </View>
                <SignIn />
              </View>
            </ScrollView>
          </View>
        </GestureHandlerRootView>
      </>
    );
  }

  return (
    <>
      <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
      <GestureHandlerRootView
        className={isDarkColorScheme ? "dark flex-1" : "flex-1"}
      >
        {/* Apply NativeWind theme variables for dynamic CSS variable switching */}
        <View
          className="flex-1"
          style={isDarkColorScheme ? themeVars.dark : themeVars.light}
        >
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="modal"
              options={{ title: "Modal", presentation: "modal" }}
            />
          </Stack>
          <PortalHost />
        </View>
      </GestureHandlerRootView>
    </>
  );
}

/**
 * Root layout with providers.
 * ColorSchemeProvider wraps everything so theme state is shared.
 */
export default function RootLayout() {
  const storage = React.useMemo(() => createSecureStoreAdapter(), []);
  const stateAuthClient = React.useMemo(
    () => ({
      useSession: authClient.useSession,
      listAccounts: async () => {
        const result = await authClient.listAccounts();
        if (!(result && "data" in result) || result.data == null) {
          return null;
        }
        return { data: result.data };
      },
    }),
    []
  );
  const config = React.useMemo(
    () => ({
      orpc,
      authClient: stateAuthClient,
      notifyError: (error: Error) => {
        console.log(error);
      },
    }),
    [stateAuthClient]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StateProvider config={config} storage={storage}>
        <ColorSchemeProvider>
          <RootLayoutContent />
        </ColorSchemeProvider>
      </StateProvider>
    </QueryClientProvider>
  );
}
