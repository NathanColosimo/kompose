import React, { useEffect } from "react";
import {
  Dimensions,
  Platform,
  Modal,
  ScrollView,
  TouchableWithoutFeedback,
  type ViewStyle,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/use-color";
import { BORDER_RADIUS } from "@/theme/globals";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const MAX_TRANSLATE_Y = -SCREEN_HEIGHT + 50;
const SPRING_CONFIG = { damping: 50, stiffness: 400 };

type BottomSheetContentProps = {
  children: React.ReactNode;
  title?: string;
  headerRight?: React.ReactNode;
  style?: ViewStyle;
  rBottomSheetStyle: any;
  cardColor: string;
  mutedColor: string;
  onHandlePress?: () => void;
};

const BottomSheetContent = ({
  children,
  title,
  headerRight,
  style,
  rBottomSheetStyle,
  cardColor,
  mutedColor,
  onHandlePress,
}: BottomSheetContentProps) => {
  return (
    <Animated.View
      style={[
        {
          height: SCREEN_HEIGHT,
          width: "100%",
          position: "absolute",
          top: SCREEN_HEIGHT,
          backgroundColor: cardColor,
          borderTopLeftRadius: BORDER_RADIUS,
          borderTopRightRadius: BORDER_RADIUS,
        },
        rBottomSheetStyle,
        style,
      ]}
    >
      <TouchableWithoutFeedback onPress={onHandlePress}>
        <View
          style={{
            width: "100%",
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 64,
              height: 6,
              backgroundColor: mutedColor,
              borderRadius: 999,
            }}
          />
        </View>
      </TouchableWithoutFeedback>

      {(title || headerRight) && (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 16,
            paddingBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            minHeight: 44,
          }}
        >
          {title ? (
            <Text
              className="font-semibold text-lg"
              style={{ flex: 1, textAlign: headerRight ? "left" : "center" }}
            >
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {headerRight ? (
            <View style={{ marginLeft: 12 }}>{headerRight}</View>
          ) : null}
        </View>
      )}

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 16, paddingBottom: 88 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
};

type BottomSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  /**
   * After the sheet's modal has fully gone. Open the next sheet here: iOS
   * can't present a modal while another is still dismissing.
   */
  onDismissed?: () => void;
  children: React.ReactNode;
  snapPoints?: number[];
  enableBackdropDismiss?: boolean;
  title?: string;
  headerRight?: React.ReactNode;
  style?: ViewStyle;
  disablePanGesture?: boolean;
};

export function BottomSheet({
  isVisible,
  onClose,
  onDismissed,
  children,
  snapPoints = [0.3, 0.6, 0.9],
  enableBackdropDismiss = true,
  title,
  headerRight,
  style,
  disablePanGesture = false,
}: BottomSheetProps) {
  const cardColor = useColor("card");
  const mutedColor = useColor("muted");

  const translateY = useSharedValue(0);
  const context = useSharedValue({ y: 0 });
  const opacity = useSharedValue(0);
  const currentSnapIndex = useSharedValue(0);

  const snapPointsHeights = snapPoints.map((point) => -SCREEN_HEIGHT * point);
  const defaultHeight = snapPointsHeights[0];

  const [modalVisible, setModalVisible] = React.useState(false);
  const wasModalVisible = React.useRef(false);
  useEffect(() => {
    if (wasModalVisible.current && !modalVisible && Platform.OS !== "ios") {
      onDismissed?.();
    }
    wasModalVisible.current = modalVisible;
  }, [modalVisible, onDismissed]);

  useEffect(() => {
    if (isVisible) {
      setModalVisible(true);
      translateY.value = withSpring(defaultHeight, SPRING_CONFIG);
      opacity.value = withTiming(1, { duration: 300 });
      currentSnapIndex.value = 0;
    } else {
      translateY.value = withSpring(0, SPRING_CONFIG);
      opacity.value = withTiming(0, { duration: 300 }, (finished) => {
        if (finished) {
          runOnJS(setModalVisible)(false);
        }
      });
    }
  }, [isVisible, defaultHeight]);

  // Animate from JS contexts (effects, press handlers).
  const snapTo = (destination: number) => {
    translateY.value = withSpring(destination, SPRING_CONFIG);
  };

  // Animate from UI-thread worklets (gesture callbacks).
  const snapToWorklet = (destination: number) => {
    "worklet";
    translateY.value = withSpring(destination, SPRING_CONFIG);
  };

  const findClosestSnapPoint = (currentY: number) => {
    "worklet";
    let closest = snapPointsHeights[0];
    let minDistance = Math.abs(currentY - closest);
    let closestIndex = 0;

    for (let i = 0; i < snapPointsHeights.length; i++) {
      const snapPoint = snapPointsHeights[i];
      const distance = Math.abs(currentY - snapPoint);
      if (distance < minDistance) {
        minDistance = distance;
        closest = snapPoint;
        closestIndex = i;
      }
    }
    currentSnapIndex.value = closestIndex;
    return closest;
  };

  const handlePress = () => {
    const nextIndex = (currentSnapIndex.value + 1) % snapPointsHeights.length;
    currentSnapIndex.value = nextIndex;
    snapTo(snapPointsHeights[nextIndex]);
  };

  // Close animation from JS contexts (backdrop, Android hardware back).
  const animateClose = () => {
    translateY.value = withSpring(0, SPRING_CONFIG);
    opacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  };

  // Close animation from UI-thread worklets (gesture end callbacks).
  const animateCloseWorklet = () => {
    "worklet";
    translateY.value = withSpring(0, SPRING_CONFIG);
    opacity.value = withTiming(0, { duration: 300 }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  };

  const gesture = Gesture.Pan()
    // Turned off rather than unwrapped: swapping the tree would remount the
    // content, and with it any dialog open over the sheet and its scroll.
    .enabled(!disablePanGesture)
    .onStart(() => {
      context.value = { y: translateY.value };
    })
    .onUpdate((event) => {
      const newY = context.value.y + event.translationY;
      if (newY <= 0 && newY >= MAX_TRANSLATE_Y) {
        translateY.value = newY;
      }
    })
    .onEnd((event) => {
      const currentY = translateY.value;
      const velocity = event.velocityY;

      if (velocity > 500 && currentY > -SCREEN_HEIGHT * 0.2) {
        animateCloseWorklet();
        return;
      }

      const closestSnapPoint = findClosestSnapPoint(currentY);
      snapToWorklet(closestSnapPoint);
    });

  const rBottomSheetStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const rBackdropStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  const handleBackdropPress = () => {
    if (enableBackdropDismiss) {
      animateClose();
    }
  };

  return (
    <Modal
      animationType="none"
      // iOS reports the end of dismissal; Android has no dismissal to wait for.
      onDismiss={onDismissed}
      onRequestClose={animateClose}
      statusBarTranslucent
      transparent
      visible={modalVisible}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          style={[
            { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.8)" },
            rBackdropStyle,
          ]}
        >
          <TouchableWithoutFeedback onPress={handleBackdropPress}>
            <Animated.View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>

          <GestureDetector gesture={gesture}>
            <BottomSheetContent
              cardColor={cardColor}
              children={children}
              headerRight={headerRight}
              mutedColor={mutedColor}
              onHandlePress={handlePress}
              rBottomSheetStyle={rBottomSheetStyle}
              style={style}
              title={title}
            />
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function useBottomSheet() {
  const [isVisible, setIsVisible] = React.useState(false);

  const open = React.useCallback(() => {
    setIsVisible(true);
  }, []);

  const close = React.useCallback(() => {
    setIsVisible(false);
  }, []);

  const toggle = React.useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  return {
    isVisible,
    open,
    close,
    toggle,
  };
}
