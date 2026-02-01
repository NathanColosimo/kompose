import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { RefObject } from "react";
import { Pressable, type View } from "react-native";
import { useColorScheme } from "@/lib/color-scheme-context";

export const HeaderButton = ({
  onPress,
  ref,
}: {
  onPress?: () => void;
  ref?: RefObject<View>;
}) => {
  const { isDarkColorScheme } = useColorScheme();

  return (
    <Pressable
      className="mr-2 p-2 active:bg-background"
      onPress={onPress}
      ref={ref}
    >
      {({ pressed }) => (
        <FontAwesome
          color={isDarkColorScheme ? "#fafafa" : "#0a0a0a"}
          name="info-circle"
          size={20}
          style={{
            opacity: pressed ? 0.7 : 1,
          }}
        />
      )}
    </Pressable>
  );
};
