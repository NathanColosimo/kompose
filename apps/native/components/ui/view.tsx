import { forwardRef } from "react";
import { View as RNView, type ViewProps } from "react-native";

type Props = ViewProps & {
  className?: string;
};

export const View = forwardRef<RNView, Props>(
  ({ className, style, ...otherProps }, ref) => {
    return (
      <RNView
        className={className}
        ref={ref}
        style={[{ backgroundColor: "transparent" }, style]}
        {...otherProps}
      />
    );
  }
);
