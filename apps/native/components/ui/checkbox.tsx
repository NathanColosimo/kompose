import {
  Indicator as CheckboxIndicator,
  Root as CheckboxRoot,
} from "@rn-primitives/checkbox";
import { Check } from "lucide-react-native";
import { Platform } from "react-native";
import { cn } from "@/lib/utils";

type CheckboxProps = Omit<
  React.ComponentProps<typeof CheckboxRoot>,
  "checked" | "onCheckedChange"
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * Checkbox component following React Native Reusables pattern.
 * Uses @rn-primitives/checkbox under the hood.
 * @see https://reactnativereusables.com/docs/components/checkbox
 */
function Checkbox({
  checked,
  onCheckedChange,
  className,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxRoot
      checked={checked}
      className={cn(
        "h-5 w-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50",
        checked && "border-primary bg-primary",
        Platform.select({
          web: "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        }),
        className
      )}
      onCheckedChange={onCheckedChange}
      {...props}
    >
      <CheckboxIndicator className="items-center justify-center">
        <Check className="text-primary-foreground" size={14} strokeWidth={3} />
      </CheckboxIndicator>
    </CheckboxRoot>
  );
}

export { Checkbox };
export type { CheckboxProps };
