import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import { forwardRef } from "react";
import {
  Pressable,
  type TextStyle,
  TouchableOpacity,
  type TouchableOpacityProps,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Icon } from "@/components/ui/icon";
import { ButtonSpinner, type SpinnerVariant } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { useColor } from "@/hooks/use-color";
import { CORNERS, FONT_SIZE, HEIGHT } from "@/theme/globals";

export type ButtonVariant =
  | "default"
  | "destructive"
  | "success"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends Omit<TouchableOpacityProps, "style"> {
  label?: string;
  children?: React.ReactNode;
  animation?: boolean;
  haptic?: boolean;
  icon?: LucideIcon;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  loadingVariant?: SpinnerVariant;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle;
}

export const Button = forwardRef<ViewInstance, ButtonProps>(
  (
    {
      children,
      icon,
      onPress,
      variant = "default",
      size = "default",
      disabled = false,
      loading = false,
      animation = true,
      haptic = true,
      loadingVariant = "default",
      style,
      textStyle,
      ...props
    },
    ref
  ) => {
    const primaryColor = useColor("primary");
    const primaryForegroundColor = useColor("primaryForeground");
    const secondaryColor = useColor("secondary");
    const secondaryForegroundColor = useColor("secondaryForeground");
    const destructiveColor = useColor("red");
    const destructiveForegroundColor = useColor("destructiveForeground");
    const greenColor = useColor("green");
    const borderColor = useColor("border");

    const scale = useSharedValue(1);
    const brightness = useSharedValue(1);

    const getButtonStyle = (): ViewStyle => {
      const baseStyle: ViewStyle = {
        borderRadius: CORNERS,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
      };

      switch (size) {
        case "sm":
          Object.assign(baseStyle, { height: 44, paddingHorizontal: 24 });
          break;
        case "lg":
          Object.assign(baseStyle, { height: 54, paddingHorizontal: 36 });
          break;
        case "icon":
          Object.assign(baseStyle, {
            height: HEIGHT,
            width: HEIGHT,
            paddingHorizontal: 0,
          });
          break;
        default:
          Object.assign(baseStyle, { height: HEIGHT, paddingHorizontal: 32 });
      }

      switch (variant) {
        case "destructive":
          return { ...baseStyle, backgroundColor: destructiveColor };
        case "success":
          return { ...baseStyle, backgroundColor: greenColor };
        case "outline":
          return {
            ...baseStyle,
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor,
          };
        case "secondary":
          return { ...baseStyle, backgroundColor: secondaryColor };
        case "ghost":
          return { ...baseStyle, backgroundColor: "transparent" };
        case "link":
          return {
            ...baseStyle,
            backgroundColor: "transparent",
            height: "auto",
            paddingHorizontal: 0,
          };
        default:
          return { ...baseStyle, backgroundColor: primaryColor };
      }
    };

    const getButtonTextStyle = (): TextStyle => {
      const baseTextStyle: TextStyle = {
        fontSize: FONT_SIZE,
        fontWeight: "500",
      };

      switch (variant) {
        case "destructive":
          return { ...baseTextStyle, color: destructiveForegroundColor };
        case "success":
          return { ...baseTextStyle, color: destructiveForegroundColor };
        case "outline":
          return { ...baseTextStyle, color: primaryColor };
        case "secondary":
          return { ...baseTextStyle, color: secondaryForegroundColor };
        case "ghost":
          return { ...baseTextStyle, color: primaryColor };
        case "link":
          return {
            ...baseTextStyle,
            color: primaryColor,
            textDecorationLine: "underline",
          };
        default:
          return { ...baseTextStyle, color: primaryForegroundColor };
      }
    };

    const getColor = (): string => {
      switch (variant) {
        case "destructive":
          return destructiveForegroundColor;
        case "success":
          return destructiveForegroundColor;
        case "outline":
          return primaryColor;
        case "secondary":
          return secondaryForegroundColor;
        case "ghost":
          return primaryColor;
        case "link":
          return primaryColor;
        default:
          return primaryForegroundColor;
      }
    };

    const getIconSize = (): number => {
      switch (size) {
        case "sm":
          return 16;
        case "lg":
          return 24;
        case "icon":
          return 20;
        default:
          return 18;
      }
    };

    // Trigger haptic feedback without crashing when the native module isn't available.
    const triggerHapticFeedback = () => {
      if (!(haptic && !disabled && !loading && process.env.EXPO_OS === "ios")) {
        return;
      }

      if (typeof Haptics.impactAsync !== "function") {
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        (error: unknown) => {
          console.warn("[Button] Haptics unavailable", error);
        }
      );
    };

    const handlePressIn = (ev?: any) => {
      "worklet";
      triggerHapticFeedback();

      scale.value = withSpring(1.05, {
        damping: 15,
        stiffness: 400,
        mass: 0.5,
      });

      brightness.value = withSpring(1.1, {
        damping: 20,
        stiffness: 300,
      });

      props.onPressIn?.(ev);
    };

    const handlePressOut = (ev?: any) => {
      "worklet";
      scale.value = withSpring(1, {
        damping: 20,
        stiffness: 400,
        mass: 0.8,
        overshootClamping: false,
      });

      brightness.value = withSpring(1, {
        damping: 20,
        stiffness: 300,
      });

      props.onPressOut?.(ev);
    };

    const handlePress = () => {
      if (onPress && !disabled && !loading) {
        onPress();
      }
    };

    const handleTouchablePress = () => {
      triggerHapticFeedback();
      handlePress();
    };

    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: scale.value }],
        opacity: brightness.value * (disabled ? 0.5 : 1),
      };
    });

    const getFlexFromStyle = () => {
      if (!style) return null;

      const styleArray = Array.isArray(style) ? style : [style];

      // Find the last occurrence of flex (in case of multiple styles with flex)
      for (let i = styleArray.length - 1; i >= 0; i--) {
        const s = styleArray[i];
        if (s && typeof s === "object" && "flex" in s) {
          return s.flex;
        }
      }
      return null;
    };

    // Apply flex to the outer Pressable so the parent lays out the whole button.
    const getPressableStyle = (): ViewStyle => {
      const flexValue = getFlexFromStyle();
      return flexValue === 1
        ? {
            flex: 1,
            alignSelf: "stretch",
          }
        : flexValue !== null
          ? {
              flex: flexValue,
              maxHeight: size === "sm" ? 44 : size === "lg" ? 54 : HEIGHT,
            }
          : {};
    };

    const getStyleWithoutFlex = () => {
      if (!style) return style;

      const styleArray = Array.isArray(style) ? style : [style];
      return styleArray.map((s) => {
        if (s && typeof s === "object" && "flex" in s) {
          const { flex, ...restStyle } = s;
          return restStyle;
        }
        return s;
      });
    };

    const buttonStyle = getButtonStyle();
    const finalTextStyle = getButtonTextStyle();
    const contentColor = getColor();
    const iconSize = getIconSize();
    const styleWithoutFlex = getStyleWithoutFlex();

    return animation ? (
      <Pressable
        disabled={disabled || loading}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        ref={ref}
        style={getPressableStyle()}
        {...props}
      >
        <Animated.View style={[animatedStyle, buttonStyle, styleWithoutFlex]}>
          {loading ? (
            <ButtonSpinner
              color={contentColor}
              size={size}
              variant={loadingVariant}
            />
          ) : typeof children === "string" ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {icon && <Icon as={icon} color={contentColor} size={iconSize} />}
              <Text style={[finalTextStyle, textStyle]}>{children}</Text>
            </View>
          ) : (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {icon && <Icon as={icon} color={contentColor} size={iconSize} />}
              {children}
            </View>
          )}
        </Animated.View>
      </Pressable>
    ) : (
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={disabled || loading}
        onPress={handleTouchablePress}
        ref={ref}
        style={[buttonStyle, disabled && { opacity: 0.5 }, styleWithoutFlex]}
        {...props}
      >
        {loading ? (
          <ButtonSpinner
            color={contentColor}
            size={size}
            variant={loadingVariant}
          />
        ) : typeof children === "string" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {icon && <Icon as={icon} color={contentColor} size={iconSize} />}
            <Text style={[finalTextStyle, textStyle]}>{children}</Text>
          </View>
        ) : (
          children
        )}
      </TouchableOpacity>
    );
  }
);

Button.displayName = "Button";
