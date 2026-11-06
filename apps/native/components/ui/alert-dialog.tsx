import React, { useEffect } from "react";
import {
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useColor } from "@/hooks/use-color";
import { useModalPresence } from "@/hooks/use-modal-presence";

export type AlertDialogProps = {
  isVisible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  dismissible?: boolean;
  showCancelButton?: boolean;
  style?: ViewStyle;
};

export function AlertDialog({
  isVisible,
  onClose,
  title,
  description,
  children,
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  dismissible = true,
  showCancelButton = true,
  style,
}: AlertDialogProps) {
  const cardColor = useColor("card");

  const {
    finishAnimation,
    finishNativeDismiss,
    presence,
    requestClose,
  } = useModalPresence({ isVisible, onClose });
  const backdropOpacity = useSharedValue(0);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (presence !== "opening" && presence !== "closing") {
      return;
    }
    let active = true;
    const complete = () => {
      if (active) {
        finishAnimation(presence);
      }
    };

    const target = presence === "opening" ? 1 : 0;
    backdropOpacity.value = withTiming(target, { duration: 250 }, (finished) => {
      if (finished) {
        scheduleOnRN(complete);
      }
    });
    cardOpacity.value = withTiming(target, { duration: 200 });

    return () => {
      active = false;
      cancelAnimation(backdropOpacity);
      cancelAnimation(cardOpacity);
    };
  }, [presence, finishAnimation, backdropOpacity, cardOpacity]);

  const rBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const rCardFadeStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
  }));

  const handleCancel = () => {
    requestClose(onCancel);
  };

  const handleBackdropPress = () => {
    if (dismissible) {
      handleCancel();
    }
  };

  const handleConfirm = () => {
    requestClose(onConfirm);
  };

  return (
    <Modal
      animationType="none"
      onDismiss={finishNativeDismiss}
      onRequestClose={handleBackdropPress}
      statusBarTranslucent
      transparent
      visible={presence !== "hidden"}
    >
      <Animated.View style={[styles.backdrop, rBackdropStyle]}>
        <TouchableWithoutFeedback onPress={handleBackdropPress}>
          <Animated.View style={styles.backdropTouchableArea} />
        </TouchableWithoutFeedback>

        {/* Non-animated outer wrapper: handles rounded corners and clipping */}
        <View
          style={[styles.roundedWrapper, { backgroundColor: cardColor }, style]}
        >
          <Animated.View style={[styles.innerContent, rCardFadeStyle]}>
            <Card style={{ backgroundColor: "transparent", elevation: 0 }}>
              {(title || description) && (
                <CardHeader>
                  {title ? <CardTitle>{title}</CardTitle> : null}
                  {description ? (
                    <CardDescription>{description}</CardDescription>
                  ) : null}
                </CardHeader>
              )}
              {children ? <CardContent>{children}</CardContent> : null}
              <CardFooter>
                {showCancelButton && (
                  <Button onPress={handleCancel} variant="outline">
                    {cancelText}
                  </Button>
                )}
                <Button onPress={handleConfirm} style={{ flex: 1 }}>
                  {confirmText}
                </Button>
              </CardFooter>
            </Card>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdropTouchableArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  roundedWrapper: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
  },
  innerContent: {
    width: "100%",
  },
});

export function useAlertDialog() {
  const [isVisible, setIsVisible] = React.useState(false);
  const open = React.useCallback(() => setIsVisible(true), []);
  const close = React.useCallback(() => setIsVisible(false), []);
  const toggle = React.useCallback(() => setIsVisible((v) => !v), []);
  return { isVisible, open, close, toggle };
}
