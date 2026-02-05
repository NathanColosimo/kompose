import { ChevronDown, type LucideIcon } from "lucide-react-native";
import type React from "react";
import { useState } from "react";
import {
  Modal,
  Pressable,
  TextInput,
  type TextStyle,
  TouchableOpacity,
  type ViewStyle,
} from "react-native";
import { Icon } from "@/components/ui/icon";
import { ScrollView } from "@/components/ui/scroll-view";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { BORDER_RADIUS, CORNERS, FONT_SIZE, HEIGHT } from "@/theme/globals";

export interface PickerOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface PickerSection {
  title?: string;
  options: PickerOption[];
}

interface PickerProps {
  options?: PickerOption[];
  sections?: PickerSection[];
  value?: string;
  placeholder?: string;
  error?: string;
  variant?: "outline" | "filled" | "group";
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  style?: ViewStyle;
  multiple?: boolean;
  values?: string[];
  onValuesChange?: (values: string[]) => void;

  // Styling props
  label?: string;
  icon?: LucideIcon;
  rightComponent?: React.ReactNode | (() => React.ReactNode);
  inputStyle?: TextStyle;
  labelStyle?: TextStyle;
  errorStyle?: TextStyle;

  // Modal props
  modalTitle?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function Picker({
  options = [],
  sections = [],
  value,
  values = [],
  error,
  variant = "filled",
  placeholder = "Select an option...",
  onValueChange,
  onValuesChange,
  disabled = false,
  style,
  multiple = false,
  label,
  icon,
  rightComponent,
  inputStyle,
  labelStyle,
  errorStyle,
  modalTitle,
  searchable = false,
  searchPlaceholder = "Search options...",
}: PickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Move ALL theme color hooks to the top level
  const borderColor = useColor("border");
  const text = useColor("text");
  const muted = useColor("mutedForeground");
  const cardColor = useColor("card");
  const danger = useColor("red");
  const accent = useColor("accent");
  const primary = useColor("primary");
  const primaryForeground = useColor("primaryForeground");
  const input = useColor("input");
  const mutedBg = useColor("muted");
  const textMutedColor = useColor("textMuted");

  // Normalize data structure - convert options to sections format
  const normalizedSections: PickerSection[] =
    sections.length > 0 ? sections : [{ options }];

  // Filter sections based on search query
  const filteredSections =
    searchable && searchQuery
      ? normalizedSections
          .map((section) => ({
            ...section,
            options: section.options.filter((option) =>
              option.label.toLowerCase().includes(searchQuery.toLowerCase())
            ),
          }))
          .filter((section) => section.options.length > 0)
      : normalizedSections;

  // Get selected options for display
  const getSelectedOptions = () => {
    const allOptions = normalizedSections.flatMap((section) => section.options);

    if (multiple) {
      return allOptions.filter((option) => values.includes(option.value));
    }
    return allOptions.filter((option) => option.value === value);
  };

  const selectedOptions = getSelectedOptions();

  const handleSelect = (optionValue: string) => {
    if (multiple) {
      const newValues = values.includes(optionValue)
        ? values.filter((v) => v !== optionValue)
        : [...values, optionValue];
      onValuesChange?.(newValues);
    } else {
      onValueChange?.(optionValue);
      setIsOpen(false);
    }
  };

  const getDisplayText = () => {
    if (selectedOptions.length === 0) return placeholder;

    if (multiple) {
      if (selectedOptions.length === 1) {
        return selectedOptions[0].label;
      }
      return `${selectedOptions.length} selected`;
    }

    return selectedOptions[0]?.label || placeholder;
  };

  const triggerStyle: ViewStyle = {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: variant === "group" ? 0 : 16,
    borderWidth: variant === "group" ? 0 : 1,
    borderColor: variant === "outline" ? borderColor : cardColor,
    borderRadius: CORNERS,
    backgroundColor: variant === "filled" ? cardColor : "transparent",
    minHeight: variant === "group" ? "auto" : HEIGHT,
    opacity: disabled ? 0.5 : 1,
  };

  const renderOption = (
    option: PickerOption,
    sectionIndex: number,
    optionIndex: number
  ) => {
    const isSelected = multiple
      ? values.includes(option.value)
      : value === option.value;

    return (
      <TouchableOpacity
        disabled={option.disabled}
        key={`${sectionIndex}-${option.value}`}
        onPress={() => !option.disabled && handleSelect(option.value)}
        style={{
          paddingVertical: 16,
          paddingHorizontal: 20,
          borderRadius: CORNERS,
          backgroundColor: isSelected ? primary : "transparent",
          marginVertical: 2,
          alignItems: "center",
          opacity: option.disabled ? 0.3 : 1,
        }}
      >
        <View
          style={{
            width: "100%",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: isSelected ? primaryForeground : text,
              fontWeight: isSelected ? "600" : "400",
              fontSize: FONT_SIZE,
              textAlign: "center",
            }}
          >
            {option.label}
          </Text>
          {option.description && (
            <Text
              style={{
                marginTop: 4,
                fontSize: 12,
                color: isSelected ? primaryForeground : textMutedColor,
                textAlign: "center",
              }}
            >
              {option.description}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={disabled}
        onPress={() => !disabled && setIsOpen(true)}
        style={[triggerStyle, style]}
      >
        {/* Icon & Label */}
        <View
          pointerEvents="none"
          style={{
            width: label ? 128 : "auto",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          {icon && <Icon as={icon} color={error ? danger : muted} size={16} />}
          {label && (
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              pointerEvents="none"
              style={[
                {
                  color: error ? danger : muted,
                },
                labelStyle,
              ]}
            >
              {label}
            </Text>
          )}
        </View>

        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={[
              {
                fontSize: FONT_SIZE,
                color:
                  selectedOptions.length > 0
                    ? text
                    : disabled
                      ? muted
                      : error
                        ? danger
                        : muted,
              },
              inputStyle,
            ]}
          >
            {getDisplayText()}
          </Text>

          {rightComponent ? (
            typeof rightComponent === "function" ? (
              rightComponent()
            ) : (
              rightComponent
            )
          ) : (
            <ChevronDown
              color={error ? danger : muted}
              size={16}
              style={{
                transform: [{ rotate: isOpen ? "180deg" : "0deg" }],
              }}
            />
          )}
        </View>
      </TouchableOpacity>

      {/* Error message */}
      {error && (
        <Text
          style={[
            {
              color: danger,
              marginTop: 4,
            },
            errorStyle,
          ]}
        >
          {error}
        </Text>
      )}

      <Modal
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
        transparent
        visible={isOpen}
      >
        <Pressable
          onPress={() => setIsOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: cardColor,
              borderTopStartRadius: BORDER_RADIUS,
              borderTopEndRadius: BORDER_RADIUS,
              maxHeight: "70%",
              width: "100%",
              paddingBottom: 32,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            {(modalTitle || multiple) && (
              <View
                style={{
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: borderColor,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text className="font-semibold text-lg">
                  {modalTitle || "Select Options"}
                </Text>

                {multiple && (
                  <TouchableOpacity onPress={() => setIsOpen(false)}>
                    <Text
                      style={{
                        color: primary,
                        fontWeight: "500",
                      }}
                    >
                      Done
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Search */}
            {searchable && (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: borderColor,
                }}
              >
                <TextInput
                  onChangeText={setSearchQuery}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={muted}
                  style={{
                    height: 36,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: input,
                    color: text,
                    fontSize: FONT_SIZE,
                  }}
                  value={searchQuery}
                />
              </View>
            )}

            {/* Options - Updated to match date-picker styling */}
            <View style={{ height: 300 }}>
              <ScrollView
                contentContainerStyle={{
                  paddingVertical: 20,
                  paddingHorizontal: 16,
                }}
                showsVerticalScrollIndicator={false}
              >
                {filteredSections.map((section, sectionIndex) => (
                  <View key={sectionIndex}>
                    {section.title && (
                      <View
                        style={{
                          paddingHorizontal: 4,
                          paddingVertical: 12,
                          marginBottom: 8,
                        }}
                      >
                        <Text
                          style={{
                            fontWeight: "600",
                            color: textMutedColor,
                            fontSize: 12,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          {section.title}
                        </Text>
                      </View>
                    )}
                    {section.options.map((option, optionIndex) =>
                      renderOption(option, sectionIndex, optionIndex)
                    )}
                  </View>
                ))}

                {filteredSections.every(
                  (section) => section.options.length === 0
                ) && (
                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 24,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: textMutedColor,
                      }}
                    >
                      {searchQuery
                        ? "No results found"
                        : "No options available"}
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
