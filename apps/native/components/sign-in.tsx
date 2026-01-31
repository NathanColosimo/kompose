import * as Linking from "expo-linking";
import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { authClient } from "@/lib/auth-client";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
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
    const callbackURL = Linking.createURL("/(drawer)/(tabs)");
    const errorCallbackURL = Linking.createURL("/(drawer)");

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
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>Sign In</Text>

      {error ? (
        <View
          style={[
            styles.errorContainer,
            { backgroundColor: `${theme.notification}20` },
          ]}
        >
          <Text style={[styles.errorText, { color: theme.notification }]}>
            {error}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        disabled={isSocialLoading}
        onPress={handleGoogleSignIn}
        style={[
          styles.socialButton,
          {
            backgroundColor: theme.primary,
            opacity: isSocialLoading ? 0.5 : 1,
          },
        ]}
      >
        {isSocialLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Continue with Google</Text>
        )}
      </TouchableOpacity>

      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={(value) => handleFormChange("email", value)}
        placeholder="Email"
        placeholderTextColor={theme.text}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
        value={form.email}
      />

      <TextInput
        onChangeText={(value) => handleFormChange("password", value)}
        placeholder="Password"
        placeholderTextColor={theme.text}
        secureTextEntry
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
        value={form.password}
      />

      <TouchableOpacity
        disabled={isLoading}
        onPress={handleLogin}
        style={[
          styles.button,
          { backgroundColor: theme.primary, opacity: isLoading ? 0.5 : 1 },
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  errorContainer: {
    marginBottom: 12,
    padding: 8,
  },
  errorText: {
    fontSize: 14,
  },
  socialButton: {
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
  },
});

export { SignIn };
