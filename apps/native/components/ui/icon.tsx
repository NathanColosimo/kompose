import type { LucideIcon, LucideProps } from "lucide-react-native";
import { withUniwind } from "uniwind";
import { cn } from "@/lib/utils";

type IconProps = LucideProps & {
  as: LucideIcon;
};

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />;
}

const StyledIconImpl = withUniwind(IconImpl);

function Icon({ as, className, size = 14, ...props }: IconProps) {
  return (
    <StyledIconImpl
      as={as}
      className={cn("text-foreground", className)}
      size={size}
      {...props}
    />
  );
}

export { Icon };
