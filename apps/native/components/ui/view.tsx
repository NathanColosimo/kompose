import { forwardRef } from "react";
import {
  View as RNView,
  type ViewInstance,
  type ViewProps,
} from "react-native";

type Props = ViewProps & {
  className?: string;
};

export const View = forwardRef<ViewInstance, Props>(
  ({ className, style, ...otherProps }, ref) => {
    return (
      <RNView
        className={className}
        ref={ref}
        // Let Tailwind/theme classes control background colors.
        style={style}
        {...otherProps}
      />
    );
  }
);
