import type { LucideIcon, LucideProps } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { cn } from "@/lib/utils";

type IconProps = LucideProps & {
  as: LucideIcon;
};

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />;
}

cssInterop(IconImpl, {
  className: {
    target: "style",
    nativeStyleToProp: {
      height: "size",
      width: "size",
    },
  },
});

function Icon({ as, className, size = 14, ...props }: IconProps) {
  return (
    <IconImpl
      as={as}
      className={cn("text-foreground", className)}
      size={size}
      {...props}
    />
  );
}

export { Icon };
