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
import { invalidateAuthenticatedQueries } from "@/utils/orpc";

type SocialProvider = "google" | "apple";

function signInErrorMessage(error: unknown, provider: SocialProvider): string {
  if (error instanceof Error) {
    return error.message;
  }
  return `Failed to sign in with ${provider === "apple" ? "Apple" : "Google"}`;
}

export function SocialAuthButtons() {
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
          callbackURL,
          errorCallbackURL,
          provider,
        },
        {
          onError(err: unknown) {
            setError(signInErrorMessage(err, provider));
            setActiveProvider(null);
          },
          onFinished() {
            setActiveProvider(null);
          },
          onSuccess() {
            invalidateAuthenticatedQueries();
          },
        }
      );
    } catch (err) {
      setError(signInErrorMessage(err, provider));
      setActiveProvider(null);
    }
  }

  return (
    <View className="gap-4">
      {error ? (
        <Alert icon={AlertCircle} variant="destructive">
          <AlertTitle>Sign in failed</AlertTitle>
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
            <Text>Continue with Google</Text>
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
            <Text>Continue with Apple</Text>
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
