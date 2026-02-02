import { cva, type VariantProps } from "class-variance-authority";
import { Check } from "lucide-react-native";
import { Pressable, type PressableProps } from "react-native";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// Base checkbox styles with size + state variants for consistency.
const checkboxVariants = cva(
  "items-center justify-center rounded-md border border-border bg-background",
  {
    variants: {
      size: {
        sm: "h-4 w-4",
        md: "h-5 w-5",
        lg: "h-6 w-6",
      },
      checked: {
        true: "border-primary bg-primary",
        false: "",
      },
      disabled: {
        true: "opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

type CheckboxProps = Omit<PressableProps, "onPress"> &
  VariantProps<typeof checkboxVariants> & {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
    onPress?: PressableProps["onPress"];
  };

/**
 * Minimal checkbox primitive that matches the reusables style tokens.
 * Uses a pressable square with a check icon for the checked state.
 */
function Checkbox({
  checked,
  size,
  disabled,
  className,
  onCheckedChange,
  onPress,
  ...props
}: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      className={cn(checkboxVariants({ checked, size, disabled }), className)}
      disabled={disabled}
      onPress={(event) => {
        // Allow callers to stop propagation while still toggling.
        onPress?.(event);
        if (disabled) {
          return;
        }
        onCheckedChange?.(!checked);
      }}
      {...props}
    >
      {checked ? (
        <Icon
          as={Check}
          className="text-primary-foreground"
          size={size === "lg" ? 14 : 12}
        />
      ) : null}
    </Pressable>
  );
}

export { Checkbox };
