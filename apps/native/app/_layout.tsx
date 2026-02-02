import "../global.css";

import { StateProvider } from "@kompose/state/state-provider";
import { ThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
 * Inner layout that consumes the color scheme context.
 * Separated so it can access the shared theme state.
 */
function RootLayoutContent() {
  const { colorScheme, isDarkColorScheme, isLoaded } = useColorScheme();

  // Update Android nav bar when color scheme changes
  React.useEffect(() => {
    if (Platform.OS === "android") {
      setAndroidNavigationBar(colorScheme);
    }
  }, [colorScheme]);

  // Wait for theme preference to load
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeProvider value={isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light}>
      <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
      <GestureHandlerRootView
        className={isDarkColorScheme ? "dark flex-1" : "flex-1"}
      >
        {/* Apply NativeWind theme variables for dynamic CSS variable switching */}
        <View
          className="flex-1"
          style={isDarkColorScheme ? themeVars.dark : themeVars.light}
        >
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="modal"
              options={{ title: "Modal", presentation: "modal" }}
            />
          </Stack>
          <PortalHost />
        </View>
      </GestureHandlerRootView>
    </ThemeProvider>
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
