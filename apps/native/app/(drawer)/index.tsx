import { useQuery } from "@tanstack/react-query";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
import { orpc, queryClient } from "@/utils/orpc";

export default function Home() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const tasks = useQuery(orpc.tasks.list.queryOptions());
  const isConnected = tasks?.data !== undefined;
  const { data: session } = authClient.useSession();

  return (
    <Container>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.text }]}>
            BETTER T STACK
          </Text>

          {session?.user ? (
            <View
              style={[
                styles.userCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <View style={styles.userHeader}>
                <Text style={[styles.userText, { color: theme.text }]}>
                  Welcome,{" "}
                  <Text style={styles.userName}>{session.user.name}</Text>
                </Text>
              </View>
              <Text
                style={[styles.userEmail, { color: theme.text, opacity: 0.7 }]}
              >
                {session.user.email}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  authClient.signOut();
                  queryClient.invalidateQueries();
                }}
                style={[
                  styles.signOutButton,
                  { backgroundColor: theme.notification },
                ]}
              >
                <Text style={styles.signOutText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View
            style={[
              styles.statusCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              System Status
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: isConnected ? "#10b981" : "#ef4444" },
                ]}
              />
              <View style={styles.statusContent}>
                <Text style={[styles.statusTitle, { color: theme.text }]}>
                  ORPC Backend
                </Text>
                <Text
                  style={[
                    styles.statusText,
                    { color: theme.text, opacity: 0.7 },
                  ]}
                >
                  {(() => {
                    if (tasks.isLoading) {
                      return "Checking connection...";
                    }
                    if (isConnected) {
                      return "Connected to API";
                    }
                    return "API Disconnected";
                  })()}
                </Text>
              </View>
            </View>
          </View>

          {!session?.user && (
            <>
              <SignIn />
              <SignUp />
            </>
          )}
        </View>
      </ScrollView>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
  },
  userCard: {
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
  },
  userHeader: {
    marginBottom: 8,
  },
  userText: {
    fontSize: 16,
  },
  userName: {
    fontWeight: "bold",
  },
  userEmail: {
    fontSize: 14,
    marginBottom: 12,
  },
  signOutButton: {
    padding: 12,
  },
  signOutText: {
    color: "#ffffff",
  },
  statusCard: {
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusIndicator: {
    height: 8,
    width: 8,
  },
  statusContent: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: "bold",
  },
  statusText: {
    fontSize: 12,
  },
  privateDataCard: {
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
  },
  privateDataText: {
    fontSize: 14,
  },
});
