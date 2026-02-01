import { createURL } from "expo-linking";
import { AlertCircle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useColorScheme } from "@/lib/color-scheme-context";
import { NAV_THEME } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

function SignIn() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const [form, setForm] = useState({ email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFormChange(field: "email" | "password", value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Google sign-in (preferred path).
   *
   * Uses Better Auth's Expo integration to open the system browser and then
   * deep-link back into the app via the configured `scheme` in `app.json`.
   */
  async function handleGoogleSignIn() {
    if (isSocialLoading) {
      return;
    }

    setIsSocialLoading(true);
    setError(null);

    // Expo Router supports group-qualified hrefs for navigation; using the same
    // shape in deep links keeps things unambiguous.
    const callbackURL = createURL("/(tabs)");
    const errorCallbackURL = createURL("/(tabs)/settings");

    await authClient.signIn.social(
      {
        provider: "google",
        callbackURL,
        errorCallbackURL,
      },
      {
        onError(err) {
          setError(err.error?.message || "Failed to sign in with Google");
          setIsSocialLoading(false);
        },
        onSuccess() {
          // Refresh cached RPC queries once we have a session.
          queryClient.refetchQueries();
        },
        onFinished() {
          setIsSocialLoading(false);
        },
      }
    );
  }

  async function handleLogin() {
    setIsLoading(true);
    setError(null);

    await authClient.signIn.email(
      {
        email: form.email,
        password: form.password,
      },
      {
        onError(err) {
          setError(err.error?.message || "Failed to sign in");
          setIsLoading(false);
        },
        onSuccess() {
          setForm({ email: "", password: "" });
          queryClient.refetchQueries();
        },
        onFinished() {
          setIsLoading(false);
        },
      }
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {error ? (
          <Alert icon={AlertCircle} variant="destructive">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button disabled={isSocialLoading} onPress={handleGoogleSignIn}>
          {isSocialLoading ? (
            <ActivityIndicator color={theme.colors.card} size="small" />
          ) : (
            <Text>Continue with Google</Text>
          )}
        </Button>

        <Input
          autoCapitalize="none"
          keyboardType="email-address"
          onChangeText={(value) => handleFormChange("email", value)}
          placeholder="Email"
          value={form.email}
        />

        <Input
          onChangeText={(value) => handleFormChange("password", value)}
          placeholder="Password"
          secureTextEntry
          value={form.password}
        />

        <Button disabled={isLoading} onPress={handleLogin}>
          {isLoading ? (
            <ActivityIndicator color={theme.colors.card} size="small" />
          ) : (
            <Text>Sign In</Text>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export { SignIn };
