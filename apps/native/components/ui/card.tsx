import type { TextStyle, ViewStyle } from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { BORDER_RADIUS } from "@/theme/globals";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: ViewStyle;
}

export function Card({ children, className, style }: CardProps) {
  const cardColor = useColor("card");
  const foregroundColor = useColor("foreground");

  return (
    <View
      className={className}
      style={[
        {
          width: "100%",
          backgroundColor: cardColor,
          borderRadius: BORDER_RADIUS,
          padding: 18,
          shadowColor: foregroundColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 3,
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
  style?: ViewStyle;
}

export function CardHeader({ children, className, style }: CardHeaderProps) {
  return (
    <View className={className} style={[{ marginBottom: 8 }, style]}>
      {children}
    </View>
  );
}

interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
  style?: TextStyle;
}

export function CardTitle({ children, className, style }: CardTitleProps) {
  return (
    <Text
      className={className}
      style={[
        {
          marginBottom: 4,
        },
        style,
      ]}
      variant="title"
    >
      {children}
    </Text>
  );
}

interface CardDescriptionProps {
  children: React.ReactNode;
  className?: string;
  style?: TextStyle;
}

export function CardDescription({
  children,
  className,
  style,
}: CardDescriptionProps) {
  return (
    <Text className={className} style={[style]} variant="caption">
      {children}
    </Text>
  );
}

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
  style?: ViewStyle;
}

export function CardContent({ children, className, style }: CardContentProps) {
  return (
    <View className={className} style={[style]}>
      {children}
    </View>
  );
}

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
  style?: ViewStyle;
}

export function CardFooter({ children, className, style }: CardFooterProps) {
  return (
    <View
      className={className}
      style={[
        {
          marginTop: 16,
          flexDirection: "row",
          gap: 8,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
