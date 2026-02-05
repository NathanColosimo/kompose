import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";

export default function Modal() {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="p-4">
        <View className="mb-4">
          <Text className="font-bold text-foreground text-xl">Modal</Text>
        </View>
      </View>
    </ScrollView>
  );
}
