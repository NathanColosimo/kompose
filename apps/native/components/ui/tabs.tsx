import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Dimensions,
  ScrollView,
  type TextStyle,
  TouchableOpacity,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolate,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { BORDER_RADIUS, CORNERS, FONT_SIZE, HEIGHT } from "@/theme/globals";

const { width: screenWidth } = Dimensions.get("window");

// Types
interface TabsContextType {
  activeTab: string;
  setActiveTab: (value: string) => void;
  orientation: "horizontal" | "vertical";
  tabValues: string[];
  registerTab: (value: string) => void;
  unregisterTab: (value: string) => void;
  setTabContent: (value: string, content: React.ReactNode) => void;
  removeTabContent: (value: string) => void;
  getTabContent: (value: string) => React.ReactNode | undefined;
  enableSwipe?: boolean;
  navigateToAdjacentTab?: (direction: "next" | "prev") => void;
}

interface TabsProps {
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  style?: ViewStyle;
  enableSwipe?: boolean;
}

interface TabsListProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

interface TabsTriggerProps {
  children: React.ReactNode;
  value: string;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

interface TabsContentProps {
  children: React.ReactNode;
  value: string;
  style?: ViewStyle;
}

// Context
const TabsContext = createContext<TabsContextType | undefined>(undefined);

const useTabsContext = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
};

export function Tabs({
  children,
  defaultValue = "",
  value,
  onValueChange,
  orientation = "horizontal",
  style,
  enableSwipe = true,
}: TabsProps) {
  const [internalActiveTab, setInternalActiveTab] = useState(defaultValue);
  const [tabValues, setTabValues] = useState<string[]>([]);
  const tabContentsRef = useRef<Record<string, React.ReactNode>>({});

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = value !== undefined;
  const activeTab = isControlled ? value : internalActiveTab;

  // Update internal state when value prop changes (controlled mode)
  useEffect(() => {
    if (isControlled && value !== internalActiveTab) {
      setInternalActiveTab(value);
    }
  }, [value, isControlled, internalActiveTab]);

  const setActiveTab = (newValue: string) => {
    if (!isControlled) {
      // Uncontrolled mode: update internal state
      setInternalActiveTab(newValue);
    }

    // Call onValueChange callback if provided (works in both controlled and uncontrolled modes)
    if (onValueChange) {
      onValueChange(newValue);
    }
  };

  const registerTab = useCallback((tabValue: string) => {
    setTabValues((prev) => {
      if (!prev.includes(tabValue)) {
        return [...prev, tabValue];
      }
      return prev;
    });
  }, []);

  const unregisterTab = useCallback((tabValue: string) => {
    setTabValues((prev) => prev.filter((val) => val !== tabValue));
  }, []);

  const setTabContent = useCallback(
    (tabValue: string, content: React.ReactNode) => {
      tabContentsRef.current[tabValue] = content;
    },
    []
  );

  const removeTabContent = useCallback((tabValue: string) => {
    delete tabContentsRef.current[tabValue];
  }, []);

  const getTabContent = useCallback((tabValue: string) => {
    return tabContentsRef.current[tabValue];
  }, []);

  const navigateToAdjacentTab = useCallback(
    (direction: "next" | "prev") => {
      const currentIndex = tabValues.indexOf(activeTab);
      if (currentIndex === -1) return;

      let nextIndex;
      if (direction === "next") {
        nextIndex = currentIndex + 1;
        if (nextIndex >= tabValues.length) nextIndex = 0; // Loop to first
      } else {
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) nextIndex = tabValues.length - 1; // Loop to last
      }

      const nextTab = tabValues[nextIndex];
      if (nextTab) {
        setActiveTab(nextTab);
      }
    },
    [tabValues, activeTab, setActiveTab]
  );

  return (
    <TabsContext.Provider
      value={{
        activeTab,
        setActiveTab,
        orientation,
        tabValues,
        registerTab,
        unregisterTab,
        setTabContent,
        removeTabContent,
        getTabContent,
        enableSwipe,
        navigateToAdjacentTab,
      }}
    >
      <View
        style={[
          {
            flexDirection: orientation === "horizontal" ? "column" : "row",
          },
          style,
        ]}
      >
        {children}
      </View>
    </TabsContext.Provider>
  );
}

// Add this after the existing interfaces
interface CarouselTabContentProps {
  children: React.ReactNode;
  value: string;
  style?: ViewStyle;
}

function CarouselTabContent({
  children,
  value,
  style,
}: CarouselTabContentProps) {
  const {
    activeTab,
    navigateToAdjacentTab,
    tabValues,
    setTabContent,
    removeTabContent,
  } = useTabsContext();

  // Keep tab content scoped to this Tabs instance.
  setTabContent(value, children);

  useEffect(() => {
    return () => {
      removeTabContent(value);
    };
  }, [removeTabContent, value]);

  // Only render the carousel container for the active tab
  if (activeTab !== value) {
    return null;
  }

  return (
    <CarouselContainer
      activeTab={activeTab}
      onSwipe={navigateToAdjacentTab!}
      style={style}
      tabValues={tabValues}
    />
  );
}

function CarouselContainer({
  activeTab,
  tabValues,
  onSwipe,
  style,
}: {
  activeTab: string;
  tabValues: string[];
  onSwipe: (direction: "next" | "prev") => void;
  style?: ViewStyle;
}) {
  const { getTabContent } = useTabsContext();
  const translateX = useSharedValue(0);
  const isGestureActive = useSharedValue(false);
  const currentIndex = tabValues.indexOf(activeTab);

  // Reset translation when active tab changes (only if not during gesture)
  useEffect(() => {
    if (!isGestureActive.value) {
      translateX.value = withTiming(0, { duration: 300 });
    }
  }, [activeTab]);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isGestureActive.value = true;
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onEnd((event) => {
      isGestureActive.value = false;

      const threshold = screenWidth * 0.15; // Lower threshold for easier swiping
      const velocity = Math.abs(event.velocityX);
      const translation = event.translationX;

      // Determine if we should change tabs based on distance or velocity
      const shouldChangeTab =
        Math.abs(translation) > threshold || velocity > 500;

      if (shouldChangeTab) {
        if (translation > 0 && currentIndex > 0) {
          // Swiped right - go to previous tab
          runOnJS(onSwipe)("prev");
        } else if (translation < 0 && currentIndex < tabValues.length - 1) {
          // Swiped left - go to next tab
          runOnJS(onSwipe)("next");
        }
      }

      // No snapping back - let the tab change handle the reset
    });

  const getPreviousTab = () => {
    const prevIndex = currentIndex - 1;
    return prevIndex >= 0 ? tabValues[prevIndex] : null;
  };

  const getNextTab = () => {
    const nextIndex = currentIndex + 1;
    return nextIndex < tabValues.length ? tabValues[nextIndex] : null;
  };

  const previousTab = getPreviousTab();
  const nextTab = getNextTab();

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const previousStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, screenWidth * 0.5],
      [0, 1],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ translateX: translateX.value - screenWidth }],
      opacity: previousTab ? opacity : 0,
    };
  });

  const nextStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [-screenWidth * 0.5, 0],
      [1, 0],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ translateX: translateX.value + screenWidth }],
      opacity: nextTab ? opacity : 0,
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ overflow: "hidden" }}>
        {/* Previous content */}
        {previousTab && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                width: screenWidth,
                paddingTop: 16,
              },
              style,
              previousStyle,
            ]}
          >
            {getTabContent(previousTab)}
          </Animated.View>
        )}

        {/* Current content */}
        <Animated.View
          style={[
            {
              paddingTop: 16,
            },
            style,
            containerStyle,
          ]}
        >
          {getTabContent(activeTab)}
        </Animated.View>

        {/* Next content */}
        {nextTab && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                width: screenWidth,
                paddingTop: 16,
              },
              style,
              nextStyle,
            ]}
          >
            {getTabContent(nextTab)}
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
}

export function TabsList({ children, style }: TabsListProps) {
  const { orientation } = useTabsContext();
  const backgroundColor = useColor("muted");

  return (
    <View
      style={[
        {
          padding: 6,
          backgroundColor,
          borderRadius: orientation === "horizontal" ? CORNERS : BORDER_RADIUS,
        },
        style,
      ]}
    >
      <ScrollView
        contentContainerStyle={{
          flexDirection: orientation === "horizontal" ? "row" : "column",
          alignItems: "center",
        }}
        horizontal={orientation === "horizontal"}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function TabsTrigger({
  children,
  value,
  disabled = false,
  style,
  textStyle,
}: TabsTriggerProps) {
  const { activeTab, setActiveTab, orientation, registerTab, unregisterTab } =
    useTabsContext();
  const isActive = activeTab === value;

  // Register/unregister tab for swipe navigation
  useEffect(() => {
    registerTab(value);
    return () => unregisterTab(value);
  }, [value, registerTab, unregisterTab]);

  const primaryColor = useColor("primary");
  const mutedForegroundColor = useColor("mutedForeground");
  const backgroundColor = useColor("background");

  const handlePress = () => {
    if (!disabled) {
      setActiveTab(value);
    }
  };

  const triggerStyle: ViewStyle = {
    paddingHorizontal: 12,
    paddingVertical: orientation === "vertical" ? 8 : undefined,
    borderRadius: CORNERS,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HEIGHT - 8,
    backgroundColor: isActive ? backgroundColor : "transparent",
    opacity: disabled ? 0.5 : 1,
    flex: orientation === "horizontal" ? 1 : undefined,
    marginBottom: orientation === "vertical" ? 4 : 0,
    ...style,
  };

  const triggerTextStyle: TextStyle = {
    fontSize: FONT_SIZE,
    fontWeight: "500",
    color: isActive ? primaryColor : mutedForegroundColor,
    textAlign: "center",
    ...textStyle,
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={handlePress}
      style={triggerStyle}
    >
      {typeof children === "string" ? (
        <Text style={triggerTextStyle}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}

export function TabsContent({ children, value, style }: TabsContentProps) {
  const {
    activeTab,
    enableSwipe,
    orientation,
    navigateToAdjacentTab,
    tabValues,
  } = useTabsContext();
  const isActive = activeTab === value;

  // For carousel mode, we need to render all content but only show active one
  if (enableSwipe && orientation === "horizontal" && navigateToAdjacentTab) {
    return (
      <CarouselTabContent style={style} value={value}>
        {children}
      </CarouselTabContent>
    );
  }

  // Regular mode - only render active content
  if (!isActive) {
    return null;
  }

  return (
    <View
      style={[
        {
          paddingTop: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
