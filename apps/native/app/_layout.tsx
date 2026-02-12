import "../global.css";

import { StateProvider } from "@kompose/state/state-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Platform, ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SignIn } from "@/components/sign-in";
import { Text } from "@/components/ui/text";
import { useNativeRealtimeSync } from "@/hooks/use-realtime-sync";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { authClient } from "@/lib/auth-client";
import { useColorScheme } from "@/lib/color-scheme-context";
import { createSecureStoreAdapter } from "@/lib/state-storage";
import { NAV_THEME } from "@/lib/theme";
import { themeVars } from "@/lib/theme-vars";
import { orpc, queryClient } from "@/utils/orpc";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

/**
 * Inner layout that consumes the color scheme and auth state.
 * Shows sign-in screen when not authenticated.
 */
function RootLayoutContent() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();
  useNativeRealtimeSync(session?.user?.id);

  // CSS variables for Tailwind classes - React Native needs these applied explicitly
  const cssVars = isDarkColorScheme ? themeVars.dark : themeVars.light;

  // Update Android nav bar when color scheme changes
  React.useEffect(() => {
    if (Platform.OS === "android") {
      setAndroidNavigationBar(colorScheme);
    }
  }, [colorScheme]);

  // Theme for React Navigation's native components (headers, tabs)
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  // Wait for session to load
  if (isSessionLoading) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        style={cssVars}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Show sign-in screen when not authenticated
  if (!session?.user) {
    return (
      <View className="flex-1 bg-background" style={cssVars}>
        <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 24,
          }}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
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
    );
  }

  return (
    <View className="flex-1 bg-background" style={cssVars}>
      <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
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
    </View>
  );
}

/**
 * Root layout with providers.
 * Uses stable wrapper structure - GestureHandlerRootView has a static className.
 * NativeWind handles dark: variants internally via setColorScheme.
 */
export default function RootLayout() {
  const storage = React.useMemo(() => createSecureStoreAdapter(), []);
  const stateAuthClient = React.useMemo(
    () => ({
      getSession: async () => {
        const result = await authClient.getSession();
        if (!(result && "data" in result)) {
          return null;
        }
        return { data: result.data };
      },
      listAccounts: async () => {
        const result = await authClient.listAccounts();
        if (!(result && "data" in result) || result.data == null) {
          return null;
        }
        return { data: result.data };
      },
      accountInfo: async (accountId: string) => {
        const result = await authClient.accountInfo({
          query: { accountId },
        });
        return result?.data?.user ?? null;
      },
      unlinkAccount: async ({ accountId }: { accountId: string }) => {
        const accountsResult = await authClient.listAccounts();
        const accounts = accountsResult?.data ?? [];
        const account = accounts.find(
          (linkedAccount) => linkedAccount.accountId === accountId
        );

        if (!account) {
          throw new Error("Account not found.");
        }

        await new Promise<void>((resolve, reject) => {
          authClient
            .unlinkAccount(
              {
                providerId: account.providerId,
                accountId,
              },
              {
                onSuccess: () => {
                  resolve();
                },
                onError: (error) => {
                  reject(
                    new Error(
                      error.error.message ||
                        error.error.statusText ||
                        "Failed to unlink account."
                    )
                  );
                },
              }
            )
            .catch((error: unknown) => {
              reject(
                error instanceof Error
                  ? error
                  : new Error("Failed to unlink account.")
              );
            });
        });
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
        {/* Stable wrapper - className is static, NativeWind handles dark mode internally */}
        <GestureHandlerRootView className="flex-1">
          <RootLayoutContent />
        </GestureHandlerRootView>
      </StateProvider>
    </QueryClientProvider>
  );
}
