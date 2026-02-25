import type { ToolUIPart } from "ai";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { View } from "@/components/ui/view";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Approval type — mirrors the web ToolUIPartApproval union
// ---------------------------------------------------------------------------

type ToolUIPartApproval =
  | { id: string; approved?: never; reason?: never }
  | { id: string; approved: boolean; reason?: string }
  | { id: string; approved: true; reason?: string }
  | { id: string; approved: false; reason?: string }
  | undefined;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ConfirmationContextValue {
  approval: ToolUIPartApproval;
  state: ToolUIPart["state"];
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null
);

function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error(
      "Confirmation sub-components must be used inside <Confirmation>."
    );
  }
  return context;
}

// ---------------------------------------------------------------------------
// Confirmation — context provider + visual wrapper
// ---------------------------------------------------------------------------

interface ConfirmationProps {
  approval?: ToolUIPartApproval;
  children: ReactNode;
  className?: string;
  state: ToolUIPart["state"];
}

export function Confirmation({
  approval,
  children,
  className,
  state,
}: ConfirmationProps) {
  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={{ approval, state }}>
      <Alert style={{ padding: 10 }}>
        <View className={cn("gap-1.5", className)}>{children}</View>
      </Alert>
    </ConfirmationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ConfirmationRequest — visible only while awaiting approval
// ---------------------------------------------------------------------------

interface ConfirmationRequestProps {
  children?: ReactNode;
}

export function ConfirmationRequest({ children }: ConfirmationRequestProps) {
  const { state } = useConfirmation();
  if (state !== "approval-requested") {
    return null;
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// ConfirmationAccepted — visible after approval was granted
// ---------------------------------------------------------------------------

interface ConfirmationAcceptedProps {
  children?: ReactNode;
}

export function ConfirmationAccepted({ children }: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation();

  if (
    !approval?.approved ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// ConfirmationRejected — visible after approval was denied
// ---------------------------------------------------------------------------

interface ConfirmationRejectedProps {
  children?: ReactNode;
}

export function ConfirmationRejected({ children }: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation();

  if (
    approval?.approved !== false ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// ConfirmationActions — button row, only visible while awaiting approval
// ---------------------------------------------------------------------------

interface ConfirmationActionsProps {
  children: ReactNode;
  className?: string;
}

export function ConfirmationActions({
  children,
  className,
}: ConfirmationActionsProps) {
  const { state } = useConfirmation();
  if (state !== "approval-requested") {
    return null;
  }

  return (
    <View
      className={cn(
        "flex-row items-center justify-end gap-2 self-end",
        className
      )}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ConfirmationAction — individual approve/reject button
// ---------------------------------------------------------------------------

interface ConfirmationActionProps {
  children: string;
  onPress: () => void;
  variant?: ButtonVariant;
}

export function ConfirmationAction({
  children,
  onPress,
  variant = "default",
}: ConfirmationActionProps) {
  return (
    <Button
      animation={false}
      onPress={onPress}
      size="sm"
      style={{ height: 28, paddingHorizontal: 12 }}
      textStyle={{ fontSize: 12 }}
      variant={variant}
    >
      {children}
    </Button>
  );
}
