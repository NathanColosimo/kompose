import type { LucideIcon } from "lucide-react-native";
import type React from "react";
import { Alert as RNAlert, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/use-color";
import { BORDER_RADIUS } from "@/theme/globals";

type AlertVariant = "default" | "destructive";

interface AlertProps {
  children: React.ReactNode;
  variant?: AlertVariant;
  icon?: LucideIcon;
  style?: ViewStyle;
}

export function Alert({
  children,
  variant = "default",
  icon,
  style,
}: AlertProps) {
  const borderColor = useColor("border");
  const destructiveColor = useColor("destructive");
  const backgroundColor = useColor("card");
  const foregroundColor = useColor("foreground");

  return (
    <View
      style={[
        {
          position: "relative",
          padding: BORDER_RADIUS,
          borderRadius: BORDER_RADIUS,
          backgroundColor,
          borderWidth: 1,
          borderColor:
            variant === "destructive" ? destructiveColor : borderColor,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={{
            position: "absolute",
            top: BORDER_RADIUS,
            left: BORDER_RADIUS,
          }}
        >
          <Icon
            as={icon}
            color={
              variant === "destructive" ? destructiveColor : foregroundColor
            }
            size={16}
          />
        </View>
      ) : null}
      {children}
    </View>
  );
}

interface AlertTitleProps {
  children: React.ReactNode;
  style?: TextStyle;
}

export function AlertTitle({ children, style }: AlertTitleProps) {
  return (
    <Text style={[{ paddingLeft: 24 }, style]} variant="title">
      {children}
    </Text>
  );
}

interface AlertDescriptionProps {
  children: React.ReactNode;
  style?: TextStyle;
}

export function AlertDescription({ children, style }: AlertDescriptionProps) {
  return (
    <Text
      style={[
        {
          marginTop: 8,
          paddingLeft: 24,
        },
        style,
      ]}
      variant="caption"
    >
      {children}
    </Text>
  );
}

// Native Alert Functions
interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface NativeAlertOptions {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  cancelable?: boolean;
}

export const createTwoButtonAlert = (options: NativeAlertOptions) => {
  const { title, message, buttons } = options;

  const defaultButtons: AlertButton[] = [
    {
      text: "Cancel",
      onPress: () => console.log("Cancel Pressed"),
      style: "cancel",
    },
    {
      text: "OK",
      onPress: () => console.log("OK Pressed"),
    },
  ];

  RNAlert.alert(title, message, buttons || defaultButtons);
};

export const createThreeButtonAlert = (options: NativeAlertOptions) => {
  const { title, message, buttons } = options;

  const defaultButtons: AlertButton[] = [
    {
      text: "Ask me later",
      onPress: () => console.log("Ask me later pressed"),
    },
    {
      text: "Cancel",
      onPress: () => console.log("Cancel Pressed"),
      style: "cancel",
    },
    {
      text: "OK",
      onPress: () => console.log("OK Pressed"),
    },
  ];

  RNAlert.alert(title, message, buttons || defaultButtons);
};

export const showNativeAlert = (options: NativeAlertOptions) => {
  const { title, message, buttons, cancelable = true } = options;

  if (!buttons || buttons.length === 0) {
    RNAlert.alert(title, message, [
      {
        text: "OK",
        onPress: () => console.log("OK Pressed"),
      },
    ]);
  } else {
    RNAlert.alert(title, message, buttons, { cancelable });
  }
};

export const showSuccessAlert = (
  title: string,
  message?: string,
  onOk?: () => void
) => {
  showNativeAlert({
    title,
    message,
    buttons: [
      {
        text: "OK",
        onPress: onOk || (() => console.log("Success acknowledged")),
      },
    ],
  });
};

export const showErrorAlert = (
  title: string,
  message?: string,
  onOk?: () => void
) => {
  showNativeAlert({
    title,
    message,
    buttons: [
      {
        text: "OK",
        onPress: onOk || (() => console.log("Error acknowledged")),
        style: "destructive",
      },
    ],
  });
};

export const showConfirmAlert = (
  title: string,
  message?: string,
  onConfirm?: () => void,
  onCancel?: () => void
) => {
  showNativeAlert({
    title,
    message,
    buttons: [
      {
        text: "Cancel",
        onPress: onCancel || (() => console.log("Cancelled")),
        style: "cancel",
      },
      {
        text: "Confirm",
        onPress: onConfirm || (() => console.log("Confirmed")),
      },
    ],
  });
};

export { RNAlert as NativeAlert };
