import React, { useEffect } from "react";
import {
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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

export type AlertDialogProps = {
  isVisible: boolean;
  /**
   * After the dialog fades out from its own Cancel, backdrop tap or
   * confirm. Omit it when the caller hides the dialog by `isVisible`.
   */
  onClose?: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  confirmText?: string;
  /** "destructive" for an action that can't be undone, such as Delete. */
  confirmVariant?: "default" | "destructive";
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  /**
   * The confirm action is running: its button reads `pendingText`, and
   * nothing closes the dialog until the caller hides it.
   */
  pending?: boolean;
  pendingText?: string;
  /** The confirm button is off (nothing to confirm yet). */
  confirmDisabled?: boolean;
  /**
   * False when the caller closes the dialog itself (by `isVisible`), as
   * after an async confirm.
   */
  closeOnConfirm?: boolean;
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
  confirmVariant = "default",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  pending = false,
  confirmDisabled = false,
  pendingText = "Saving…",
  closeOnConfirm = true,
  dismissible = true,
  showCancelButton = true,
  style,
}: AlertDialogProps) {
  const cardColor = useColor("card");

  const [modalVisible, setModalVisible] = React.useState(false);
  const backdropOpacity = useSharedValue(0);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (isVisible) {
      setModalVisible(true);
      backdropOpacity.value = withTiming(1, { duration: 250 });
      cardOpacity.value = withTiming(1, { duration: 200 });
    } else if (backdropOpacity.value === 0) {
      setModalVisible(false);
    } else {
      backdropOpacity.value = withTiming(0, { duration: 250 }, (finished) => {
        if (finished) {
          runOnJS(setModalVisible)(false);
        }
      });
      cardOpacity.value = withTiming(0, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  const rBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const rCardFadeStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
  }));

  const animateClose = () => {
    "worklet";
    backdropOpacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished && onClose) {
        runOnJS(onClose)();
      }
    });
    cardOpacity.value = withTiming(0, { duration: 200 });
  };

  const handleBackdropPress = () => {
    if (dismissible && !pending) {
      animateClose();
      if (onCancel) onCancel();
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    animateClose();
  };

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    if (closeOnConfirm) {
      animateClose();
    }
  };

  return (
    <Modal
      animationType="none"
      statusBarTranslucent
      transparent
      visible={modalVisible}
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
            <Card
              style={{ backgroundColor: "transparent", elevation: 0 }}
            >
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
                  <Button
                    disabled={pending}
                    onPress={handleCancel}
                    variant="outline"
                  >
                    {cancelText}
                  </Button>
                )}
                <Button
                  disabled={pending || confirmDisabled}
                  onPress={handleConfirm}
                  style={{ flex: 1 }}
                  variant={confirmVariant}
                >
                  {pending ? pendingText : confirmText}
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
