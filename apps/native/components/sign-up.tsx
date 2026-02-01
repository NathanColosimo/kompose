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

function SignUp() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Google sign-in (preferred path).
   *
   * Better Auth handles new vs existing users internally, so this works for
   * "sign up" as well.
   */
  async function handleGoogleSignUp() {
    if (isSocialLoading) {
      return;
    }

    setIsSocialLoading(true);
    setError(null);

    const callbackURL = createURL("/(tabs)");
    const errorCallbackURL = createURL("/(tabs)/settings");

    await authClient.signIn.social(
      {
        provider: "google",
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL,
      },
      {
        onError(err) {
          setError(err.error?.message || "Failed to sign up with Google");
          setIsSocialLoading(false);
        },
        onSuccess() {
          queryClient.refetchQueries();
        },
        onFinished() {
          setIsSocialLoading(false);
        },
      }
    );
  }

  async function handleSignUp() {
    setIsLoading(true);
    setError(null);

    await authClient.signUp.email(
      {
        name,
        email,
        password,
      },
      {
        onError(err) {
          setError(err.error?.message || "Failed to sign up");
          setIsLoading(false);
        },
        onSuccess() {
          setName("");
          setEmail("");
          setPassword("");
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
        <CardTitle>Create Account</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {error ? (
          <Alert icon={AlertCircle} variant="destructive">
            <AlertTitle>Sign up failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button disabled={isSocialLoading} onPress={handleGoogleSignUp}>
          {isSocialLoading ? (
            <ActivityIndicator color={theme.colors.card} size="small" />
          ) : (
            <Text>Create with Google</Text>
          )}
        </Button>

        <Input onChangeText={setName} placeholder="Name" value={name} />

        <Input
          autoCapitalize="none"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          value={email}
        />

        <Input
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          value={password}
        />

        <Button disabled={isLoading} onPress={handleSignUp}>
          {isLoading ? (
            <ActivityIndicator color={theme.colors.card} size="small" />
          ) : (
            <Text>Sign Up</Text>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export { SignUp };
