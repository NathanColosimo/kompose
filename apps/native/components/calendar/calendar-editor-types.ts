import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { CalendarIdentifier } from "@kompose/state/atoms/visible-calendars";
import type { Temporal } from "temporal-polyfill";

export type CalendarOption = CalendarIdentifier & {
  label: string;
  color?: string | null;
};

interface EventDraftBase {
  summary: string;
  description: string;
  location: string;
  colorId?: string | null;
  calendar: CalendarIdentifier;
  allDay: boolean;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
  endTime: Temporal.PlainTime | null;
  recurrence: string[];
  conferenceData?: GoogleEvent["conferenceData"] | null;
}

export interface CreateEventDraft extends EventDraftBase {
  mode: "create";
}

export interface EditEventDraft extends EventDraftBase {
  mode: "edit";
  eventId: string;
  sourceCalendar: CalendarIdentifier;
  sourceEvent: GoogleEvent;
}

export type EventDraft = CreateEventDraft | EditEventDraft;

export function isEditEventDraft(draft: EventDraft): draft is EditEventDraft {
  return draft.mode === "edit";
}
