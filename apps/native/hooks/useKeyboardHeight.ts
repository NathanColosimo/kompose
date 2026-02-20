import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  Platform,
} from "react-native";

interface UseKeyboardHeightReturn {
  isKeyboardVisible: boolean;
  keyboardAnimationDuration: number;
  keyboardHeight: number;
}

export function useKeyboardHeight(): UseKeyboardHeightReturn {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardAnimationDuration, setKeyboardAnimationDuration] = useState(0);
  const previousHeightRef = useRef(0);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(
      showEvent,
      (event: KeyboardEvent) => {
        const height = event.endCoordinates.height;
        if (height > 0) {
          setKeyboardHeight(height);
          setIsKeyboardVisible(true);
          setKeyboardAnimationDuration(event.duration ?? 250);
          previousHeightRef.current = height;
        }
      }
    );

    const hideSubscription = Keyboard.addListener(
      hideEvent,
      (event: KeyboardEvent) => {
        setKeyboardHeight(0);
        setIsKeyboardVisible(false);
        setKeyboardAnimationDuration(
          event.duration ?? (Platform.OS === "ios" ? 250 : 200)
        );
      }
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const dimensionSubscription = Dimensions.addEventListener("change", () => {
      if (!isKeyboardVisible || previousHeightRef.current <= 0) {
        return;
      }

      const { height, width } = Dimensions.get("window");
      if (Platform.OS === "ios" && width > height) {
        setKeyboardHeight(Math.min(previousHeightRef.current, height * 0.4));
      }
    });

    return () => {
      dimensionSubscription.remove();
    };
  }, [isKeyboardVisible]);

  return {
    keyboardHeight,
    isKeyboardVisible,
    keyboardAnimationDuration,
  };
}
