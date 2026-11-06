import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

type ModalPresence = "hidden" | "opening" | "open" | "closing";

export function useModalPresence({
  isVisible,
  onClose,
  onDismissed,
}: {
  isVisible: boolean;
  onClose: () => void;
  onDismissed?: () => void;
}) {
  const [presence, setPresence] = useState<ModalPresence>("hidden");
  const presenceRef = useRef(presence);
  const awaitingNativeDismiss = useRef(false);
  const wantsOpen = useRef(isVisible);
  const notifyClose = useRef(false);
  const callbacks = useRef({ onClose, onDismissed });

  useLayoutEffect(() => {
    callbacks.current = { onClose, onDismissed };
  }, [onClose, onDismissed]);

  const transitionTo = useCallback((next: ModalPresence) => {
    presenceRef.current = next;
    setPresence(next);
  }, []);

  useEffect(() => {
    wantsOpen.current = isVisible;
    if (isVisible) {
      notifyClose.current = false;
      if (!awaitingNativeDismiss.current) {
        transitionTo("opening");
      }
    } else if (
      presenceRef.current === "opening" ||
      presenceRef.current === "open"
    ) {
      transitionTo("closing");
    }
  }, [isVisible, transitionTo]);

  const requestClose = useCallback(
    (beforeClose?: () => void) => {
      if (presenceRef.current !== "opening" && presenceRef.current !== "open") {
        return;
      }
      wantsOpen.current = false;
      notifyClose.current = true;
      transitionTo("closing");
      beforeClose?.();
    },
    [transitionTo]
  );

  const finishAnimation = useCallback(
    (phase: "opening" | "closing") => {
      if (presenceRef.current !== phase) {
        return;
      }
      awaitingNativeDismiss.current = phase === "closing";
      transitionTo(phase === "opening" ? "open" : "hidden");
    },
    [transitionTo]
  );

  const finishNativeDismiss = useCallback(() => {
    if (!awaitingNativeDismiss.current || presenceRef.current !== "hidden") {
      return;
    }
    awaitingNativeDismiss.current = false;
    if (notifyClose.current) {
      notifyClose.current = false;
      callbacks.current.onClose();
    }
    callbacks.current.onDismissed?.();
    if (wantsOpen.current) {
      transitionTo("opening");
    }
  }, [transitionTo]);

  useEffect(() => {
    // React Native only emits Modal.onDismiss on iOS. Elsewhere, hiding the
    // modal removes its native host in this commit.
    if (presence === "hidden" && Platform.OS !== "ios") {
      finishNativeDismiss();
    }
  }, [finishNativeDismiss, presence]);

  return {
    finishAnimation,
    finishNativeDismiss,
    presence,
    requestClose,
  };
}
