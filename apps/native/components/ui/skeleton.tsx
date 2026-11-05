import { useEffect } from "react";
import type { ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useColor } from "@/hooks/use-color";
import { BORDER_RADIUS, CORNERS } from "@/theme/globals";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  style?: ViewStyle;
  variant?: "default" | "rounded";
}

export function Skeleton({
  width = "100%",
  height = 100,
  style,
  variant = "default",
}: SkeletonProps) {
  const mutedColor = useColor("muted");
  const opacity = useSharedValue(0.5);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, {
        duration: 1000,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true
    );
  }, []); // Use an empty dependency array as the shared value object is stable

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          backgroundColor: mutedColor,
          borderRadius: variant === "default" ? CORNERS : BORDER_RADIUS,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}
