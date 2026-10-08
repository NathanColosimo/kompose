"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";

/** A failed session read is a connection error, not evidence of signing out. */
export function SessionFeedback({
  error,
  retrying,
  onRetry,
}: {
  error: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const handleRetry = useCallback(() => onRetry(), [onRetry]);
  if (!error) {
    return <p role="status">Loading your workspace…</p>;
  }

  return (
    <div className="space-y-3" role="alert">
      <p>Unable to load your workspace. Check your connection and try again.</p>
      <Button disabled={retrying} onClick={handleRetry}>
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
