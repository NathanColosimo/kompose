import { Check } from "lucide-react-native";
import {
  type TextStyle,
  TouchableOpacity,
  type TouchableOpacityProps,
  type ViewStyle,
} from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { BORDER_RADIUS } from "@/theme/globals";

interface CheckboxProps
  extends Omit<TouchableOpacityProps, "onPress" | "children"> {
  checked: boolean;
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  style?: ViewStyle;
  labelStyle?: TextStyle;
  onCheckedChange: (checked: boolean) => void;
}

export function Checkbox({
  checked,
  error,
  disabled = false,
  label,
  className,
  style,
  labelStyle,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  const primary = useColor("primary");
  const primaryForegroundColor = useColor("primaryForeground");
  const danger = useColor("red");
  const borderColor = useColor("border");

  return (
    <TouchableOpacity
      className={className}
      disabled={disabled}
      onPress={() => !disabled && onCheckedChange(!checked)}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          opacity: disabled ? 0.5 : 1,
          paddingVertical: 4,
        },
        style,
      ]}
      {...props}
    >
      <View
        style={{
          width: BORDER_RADIUS,
          height: BORDER_RADIUS,
          borderRadius: BORDER_RADIUS,
          borderWidth: 1.5,
          borderColor: checked ? primary : borderColor,
          backgroundColor: checked ? primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
          marginRight: label ? 8 : 0,
        }}
      >
        {checked && (
          <Check
            color={primaryForegroundColor}
            size={16}
            strokeLinecap="round"
            strokeWidth={3}
          />
        )}
      </View>
      {label && (
        <Text
          ellipsizeMode="tail"
          numberOfLines={1}
          pointerEvents="none"
          style={[
            {
              color: error ? danger : primary,
            },
            labelStyle,
          ]}
          variant="caption"
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}
