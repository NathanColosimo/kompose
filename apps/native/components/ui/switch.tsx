import {
  Switch as RNSwitch,
  type SwitchProps as RNSwitchProps,
  type TextStyle,
} from "react-native";

import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";

interface SwitchProps extends RNSwitchProps {
  label?: string;
  error?: string;
  labelStyle?: TextStyle;
}

export function Switch({ label, error, labelStyle, ...props }: SwitchProps) {
  const mutedColor = useColor("muted");
  const primary = useColor("primary");
  const danger = useColor("red");

  return (
    <View style={{ marginBottom: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 32, // Ensure consistent height
        }}
      >
        {label && (
          <Text
            ellipsizeMode="tail" // Allow wrapping for longer labels
            numberOfLines={2}
            pointerEvents="none"
            style={[
              {
                color: error ? danger : primary,
                flex: 1, // Take available space
                marginRight: 12, // Add spacing between label and switch
              },
              labelStyle,
            ]}
          >
            {label}
          </Text>
        )}

        <RNSwitch
          thumbColor={props.value ? "#ffffff" : "#f4f3f4"}
          trackColor={{ false: mutedColor, true: "#7DD87D" }}
          {...props}
        />
      </View>

      {error && (
        <Text
          ellipsizeMode="tail"
          numberOfLines={2}
          pointerEvents="none"
          style={[
            {
              fontSize: 12, // Slightly smaller for error text
              color: danger, // Always use danger color for errors
              marginTop: 4, // Add spacing above error text
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
