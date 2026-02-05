import { Link, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="items-center p-4">
          <Text className="mb-4 text-5xl">🤔</Text>
          <Text className="mb-2 text-center font-bold text-foreground text-xl">
            Page Not Found
          </Text>
          <Text className="mb-6 text-center text-muted-foreground text-sm">
            Sorry, the page you're looking for doesn't exist.
          </Text>
          <Link asChild href="/">
            <Text className="bg-primary/10 p-3 text-primary">Go to Home</Text>
          </Link>
        </View>
      </ScrollView>
    </>
  );
}
