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

    const callbackURL = Linking.createURL("/(drawer)/(tabs)");
    const errorCallbackURL = Linking.createURL("/(drawer)");

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
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>Create Account</Text>

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
        onPress={handleGoogleSignUp}
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
          <Text style={styles.buttonText}>Create with Google</Text>
        )}
      </TouchableOpacity>

      <TextInput
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={theme.text}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
        value={name}
      />

      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={setEmail}
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
        value={email}
      />

      <TextInput
        onChangeText={setPassword}
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
        value={password}
      />

      <TouchableOpacity
        disabled={isLoading}
        onPress={handleSignUp}
        style={[
          styles.button,
          { backgroundColor: theme.primary, opacity: isLoading ? 0.5 : 1 },
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Sign Up</Text>
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

export { SignUp };
