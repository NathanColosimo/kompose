import { View } from "react-native";
import { Container } from "@/components/container";
import { Text } from "@/components/ui/text";

export default function Modal() {
  return (
    <Container>
      <View className="flex-1 p-4">
        <View className="mb-4">
          <Text className="font-bold text-foreground text-xl">Modal</Text>
        </View>
      </View>
    </Container>
  );
}
