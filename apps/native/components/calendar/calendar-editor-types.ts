import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { CalendarIdentifier } from "@kompose/state/atoms/visible-calendars";
import type { Temporal } from "temporal-polyfill";

export type CalendarOption = CalendarIdentifier & {
  label: string;
  color?: string | null;
  /** Google's access role: only owners and writers can change events. */
  accessRole?: string | null;
};

interface EventDraftBase {
  allDay: boolean;
  calendar: CalendarIdentifier;
  colorId?: string | null;
  conferenceData?: GoogleEvent["conferenceData"] | null;
  description: string;
  endDate: Temporal.PlainDate;
  endTime: Temporal.PlainTime | null;
  location: string;
  recurrence: string[];
  /**
   * The user used the Repeat control. Only then is the repeat saved, since
   * an occurrence's pattern may load after the editor opened.
   */
  recurrenceEdited?: boolean;
  startDate: Temporal.PlainDate;
  startTime: Temporal.PlainTime | null;
  summary: string;
}

export interface CreateEventDraft extends EventDraftBase {
  mode: "create";
}

export interface EditEventDraft extends EventDraftBase {
  eventId: string;
  mode: "edit";
  sourceCalendar: CalendarIdentifier;
  sourceEvent: GoogleEvent;
}

export type EventDraft = CreateEventDraft | EditEventDraft;

export function isEditEventDraft(draft: EventDraft): draft is EditEventDraft {
  return draft.mode === "edit";
}
