"use client";

import {
  EventCreationContext,
  useEventCreationState,
} from "./use-event-creation";

interface EventCreationProviderProps {
  children: React.ReactNode;
}

/**
 * EventCreationProvider - Provides event creation context to children.
 * Wrap the calendar view with this to enable click-and-drag event creation.
 */
export function EventCreationProvider({
  children,
}: EventCreationProviderProps) {
  const value = useEventCreationState();

  return (
    <EventCreationContext.Provider value={value}>
      {children}
    </EventCreationContext.Provider>
  );
}
