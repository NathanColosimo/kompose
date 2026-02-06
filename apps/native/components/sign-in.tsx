import { createURL } from "expo-linking";
import { AlertCircle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useColorScheme } from "@/lib/color-scheme-context";
import { NAV_THEME } from "@/lib/theme";
import { invalidateSessionQueries } from "@/utils/orpc";

/**
 * Google-only sign in component.
 * Email/password auth is not enabled for this app.
 */
function SignIn() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Google sign-in using Better Auth's Expo integration.
   * Opens the system browser and deep-links back via the app scheme.
   */
  async function handleGoogleSignIn() {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    // Use route paths (groups like "(tabs)" are not part of the URL).
    const callbackURL = createURL("");
    const errorCallbackURL = createURL("settings");

    // Debug: Log the URLs being used
    console.log("[SignIn] Server URL:", process.env.EXPO_PUBLIC_SERVER_URL);
    console.log("[SignIn] Callback URL:", callbackURL);
    console.log("[SignIn] Error Callback URL:", errorCallbackURL);

    try {
      await authClient.signIn.social(
        {
          provider: "google",
          callbackURL,
          errorCallbackURL,
        },
        {
          onError(err) {
            setError(err.error?.message || "Failed to sign in with Google");
            setIsLoading(false);
          },
          onSuccess() {
            invalidateSessionQueries();
          },
          onFinished() {
            setIsLoading(false);
          },
        }
      );
    } catch {
      setError(
        `Couldn't reach ${process.env.EXPO_PUBLIC_SERVER_URL}. Make sure your API server is running.`
      );
      setIsLoading(false);
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

      <Button disabled={isLoading} onPress={handleGoogleSignIn}>
        {isLoading ? (
          <ActivityIndicator color={theme.colors.card} size="small" />
        ) : (
          <Text>Continue with Google</Text>
        )}
      </Button>
    </View>
  );
}

export { SignIn };
