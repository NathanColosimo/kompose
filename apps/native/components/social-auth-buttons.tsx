import { createURL } from "expo-linking";
import { AlertCircle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useColorScheme } from "@/lib/color-scheme-context";
import { NAV_THEME } from "@/lib/theme";
import { invalidateSessionQueries } from "@/utils/orpc";

type SocialProvider = "google" | "apple";

interface SocialAuthButtonsProps {
  mode: "sign-in" | "sign-up";
}

const copyByMode = {
  "sign-in": {
    errorTitle: "Sign in failed",
    action: "sign in",
    googleLabel: "Continue with Google",
    appleLabel: "Continue with Apple",
  },
  "sign-up": {
    errorTitle: "Sign up failed",
    action: "sign up",
    googleLabel: "Create with Google",
    appleLabel: "Create with Apple",
  },
} as const;

export function SocialAuthButtons({ mode }: SocialAuthButtonsProps) {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const lastUsedMethod = authClient.getLastUsedLoginMethod();

  async function handleSocialSignIn(provider: SocialProvider) {
    if (activeProvider) {
      return;
    }

    setActiveProvider(provider);
    setError(null);

    const callbackURL = createURL("");
    const errorCallbackURL = createURL("settings");

    try {
      await authClient.signIn.social(
        {
          provider,
          callbackURL,
          errorCallbackURL,
          ...(mode === "sign-up" ? { newUserCallbackURL: callbackURL } : {}),
        },
        {
          // biome-ignore lint/suspicious/noExplicitAny: Error handling
          onError(err: unknown) {
            setError(
              err instanceof Error
                ? err.message
                : `Failed to ${copyByMode[mode].action} with ${provider === "apple" ? "Apple" : "Google"}`
            );
            setActiveProvider(null);
          },
          onSuccess() {
            invalidateSessionQueries();
          },
          onFinished() {
            setActiveProvider(null);
          },
        }
      );
    } catch (err) {
      const fallbackMessage =
        err instanceof Error
          ? err.message
          : `Failed to ${copyByMode[mode].action} with ${
              provider === "apple" ? "Apple" : "Google"
            }`;
      setError(fallbackMessage);
      setActiveProvider(null);
    }
  }

  return (
    <View className="gap-4">
      {error ? (
        <Alert icon={AlertCircle} variant="destructive">
          <AlertTitle>{copyByMode[mode].errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        disabled={activeProvider !== null}
        onPress={() => handleSocialSignIn("google")}
      >
        {activeProvider === "google" ? (
          <ActivityIndicator color={theme.colors.card} size="small" />
        ) : (
          <View className="flex-row items-center gap-2">
            <Text>{copyByMode[mode].googleLabel}</Text>
            {lastUsedMethod === "google" ? (
              <Badge style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                Last used
              </Badge>
            ) : null}
          </View>
        )}
      </Button>

      <Button
        disabled={activeProvider !== null}
        onPress={() => handleSocialSignIn("apple")}
        variant="outline"
      >
        {activeProvider === "apple" ? (
          <ActivityIndicator color={theme.colors.card} size="small" />
        ) : (
          <View className="flex-row items-center gap-2">
            <Text>{copyByMode[mode].appleLabel}</Text>
            {lastUsedMethod === "apple" ? (
              <Badge style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                Last used
              </Badge>
            ) : null}
          </View>
        )}
      </Button>
    </View>
  );
}
