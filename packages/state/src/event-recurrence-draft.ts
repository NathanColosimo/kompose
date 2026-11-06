import type { Event } from "@kompose/google-cal/schema";

export type RecurrenceDraft =
  | { kind: "inherit" }
  | { kind: "override"; rules: string[] };

export type ResolvedRecurrence =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; rules: string[] };

export function resolveEventRecurrence({
  draft,
  event,
  master,
}: {
  draft: RecurrenceDraft;
  event?: Pick<Event, "recurrence" | "recurringEventId">;
  master: {
    data?: Pick<Event, "recurrence">;
    isError: boolean;
  };
}): ResolvedRecurrence {
  // Instances inherit from the query cache; form defaults never own this data.
  if (event?.recurringEventId && !event.recurrence?.length) {
    if (master.isError) {
      return { kind: "error" };
    }
    if (!master.data) {
      return { kind: "loading" };
    }
  }
  if (draft.kind === "override") {
    return { kind: "ready", rules: draft.rules };
  }
  return {
    kind: "ready",
    rules: event?.recurrence?.length
      ? event.recurrence
      : (master.data?.recurrence ?? []),
  };
}
