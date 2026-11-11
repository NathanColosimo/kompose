import "../global.css";

import type { StateConfig } from "@kompose/state/config";
import { errorMessage } from "@kompose/state/errors";
import { StateProvider } from "@kompose/state/state-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { Text } from "@/components/ui/text";
import { useNativeRealtimeSync } from "@/hooks/use-realtime-sync";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { authClient } from "@/lib/auth-client";
import { restoreColorScheme, useColorScheme } from "@/lib/color-scheme-context";
import { createSecureStoreAdapter } from "@/lib/state-storage";
import { NAV_THEME } from "@/lib/theme";
import { orpc, queryClient } from "@/utils/orpc";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function RootLayoutContent() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const sessionUser = session?.user;
  useNativeRealtimeSync(sessionUser?.id);

  React.useEffect(() => {
    setAndroidNavigationBar(colorScheme);
  }, [colorScheme]);

  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  if (isSessionPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!sessionUser) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
        <View className="gap-6">
          <View className="items-center gap-2">
            <Text className="font-bold text-2xl text-foreground">
              Welcome to Kompose
            </Text>
            <Text className="text-center text-muted-foreground">
              Sign in to access your calendar and tasks
            </Text>
          </View>
          <SocialAuthButtons />
        </View>
      </View>
    );
  }

  // The theme reaches every native header, so iOS draws header glass for
  // the active scheme instead of always for light.
  return (
    <ThemeProvider value={theme}>
      <View className="flex-1 bg-background">
        <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: theme.colors.background },
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.text,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </View>
    </ThemeProvider>
  );
}

const storage = createSecureStoreAdapter();

const stateConfig: StateConfig = {
  authClient: {
    accountInfo: async (accountId: string) => {
      const result = await authClient.accountInfo({
        query: { accountId },
      });
      return result?.data?.user ?? null;
    },
    listAccounts: () =>
      authClient.listAccounts({ fetchOptions: { throw: true } }),
    unlinkAccount: async ({ accountId }: { accountId: string }) => {
      const { error } = await authClient.unlinkAccount({ accountId });
      if (error) {
        throw new Error(error.message || "Failed to unlink account.");
      }
    },
  },
  notifyError: (error: Error) => {
    Alert.alert(errorMessage(error));
  },
  orpc,
};

export default function RootLayout() {
  React.useEffect(() => {
    restoreColorScheme();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StateProvider config={stateConfig} storage={storage}>
        {/* Keep the gesture root stable; Uniwind applies theme changes globally. */}
        <GestureHandlerRootView className="flex-1">
          <RootLayoutContent />
        </GestureHandlerRootView>
      </StateProvider>
    </QueryClientProvider>
  );
}
