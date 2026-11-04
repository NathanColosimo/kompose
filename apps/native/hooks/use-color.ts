import { useColorScheme } from "@/lib/color-scheme-context";
import { Colors } from "@/theme/colors";

export function useColor(
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
  props?: { light?: string; dark?: string }
) {
  const { colorScheme } = useColorScheme();
  const colorFromProps = props?.[colorScheme];

  if (colorFromProps) {
    return colorFromProps;
  }
  return Colors[colorScheme][colorName];
}
