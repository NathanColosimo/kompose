import { ScrollView, View } from "react-native";
import { ModeToggle } from "@/components/mode-toggle";
import { ConnectedAgentsSection } from "@/components/settings/connected-agents-section";
import { PluginConnectionsSections } from "@/components/settings/plugin-connections-section";
import {
  RowAction,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { authClient } from "@/lib/auth-client";
import { clearAuthenticatedQueries } from "@/utils/orpc";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const handleSignOut = async () => {
    await authClient.signOut();
    clearAuthenticatedQueries();
  };

  return (
    <ScrollView
      className="bg-background flex-1"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="px-4 pt-4 pb-10">
        <SettingsSection title="Appearance">
          <ModeToggle />
        </SettingsSection>

        {session?.user ? <PluginConnectionsSections /> : null}

        {session?.user ? <ConnectedAgentsSection /> : null}

        {session?.user ? (
          <SettingsSection title="Account">
            <SettingsRow
              action={
                <RowAction
                  destructive
                  label="Sign out"
                  onPress={handleSignOut}
                />
              }
              detail={session.user.email}
              first
              image={session.user.image}
              name={session.user.name}
            />
          </SettingsSection>
        ) : null}
      </View>
    </ScrollView>
  );
}
