import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { RefObject } from "react";
import { Pressable, StyleSheet, type View } from "react-native";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";

export const HeaderButton = ({
  onPress,
  ref,
}: {
  onPress?: () => void;
  ref?: RefObject<View>;
}) => {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;

  return (
    <Pressable
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? theme.background : theme.card,
        },
      ]}
    >
      {({ pressed }) => (
        <FontAwesome
          color={theme.text}
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

const styles = StyleSheet.create({
  button: {
    padding: 8,
    marginRight: 8,
  },
});
