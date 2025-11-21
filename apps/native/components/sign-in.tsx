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
  const [error, setError] = useState<string | null>(null);

  function handleFormChange(field: "email" | "password", value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
        onError(error) {
          setError(error.error?.message || "Failed to sign in");
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
            { backgroundColor: theme.notification + "20" },
          ]}
        >
          <Text style={[styles.errorText, { color: theme.notification }]}>
            {error}
          </Text>
        </View>
      ) : null}

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
