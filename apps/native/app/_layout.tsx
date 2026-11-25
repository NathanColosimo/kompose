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
import { Button } from "@/components/ui/button";
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

/** A full-screen message and one action, for when no session is loaded. */
function SessionGateScreen({
  children,
  message,
  title,
}: {
  children: React.ReactNode;
  message: string;
  title: string;
}) {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <View className="bg-background flex-1 items-center justify-center p-6">
      <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
      <View className="gap-6">
        <View className="items-center gap-2">
          <Text className="text-foreground text-2xl font-bold">{title}</Text>
          <Text className="text-muted-foreground text-center">{message}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

function RootLayoutContent() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const {
    data: session,
    error: sessionError,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();
  const sessionUser = session?.user;
  useNativeRealtimeSync(sessionUser?.id);
  // Better Auth clears the error and reports pending while it checks again,
  // so this is what keeps the failed screen up during a retry.
  const [isRetryingSession, startSessionRetry] = React.useTransition();

  React.useEffect(() => {
    setAndroidNavigationBar(colorScheme);
  }, [colorScheme]);

  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;

  // A session saved on the phone shows the app at once, while the check with
  // the server is still running and after one fails.
  if (sessionUser) {
    // The theme reaches every native header, so iOS draws header glass for
    // the active scheme instead of always for light.
    return (
      <ThemeProvider value={theme}>
        <View className="bg-background flex-1">
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

  // A failed check doesn't say the user is signed out, so it offers a retry
  // instead of the sign-in screen.
  if (sessionError || isRetryingSession) {
    return (
      <SessionGateScreen
        message="Kompose couldn't be reached. Check your connection and try again."
        title="Couldn't check your sign-in"
      >
        <Button
          loading={isRetryingSession}
          onPress={() => startSessionRetry(() => refetchSession())}
        >
          Try again
        </Button>
      </SessionGateScreen>
    );
  }

  if (isSessionPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SessionGateScreen
      message="Sign in to access your calendar and tasks"
      title="Welcome to Kompose"
    >
      <SocialAuthButtons />
    </SessionGateScreen>
  );
}

const storage = createSecureStoreAdapter();

const stateConfig: StateConfig = {
  authClient: {
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
