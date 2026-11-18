import { Link, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <ScrollView
        className="bg-background flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="items-center p-4">
          <Text className="mb-4 text-5xl">🤔</Text>
          <Text className="text-foreground mb-2 text-center text-xl font-bold">
            Page Not Found
          </Text>
          <Text className="text-muted-foreground mb-6 text-center text-sm">
            Sorry, the page you're looking for doesn't exist.
          </Text>
          <Link asChild href="/">
            <Text className="bg-primary/10 text-primary p-3">Go to Home</Text>
          </Link>
        </View>
      </ScrollView>
    </>
  );
}
