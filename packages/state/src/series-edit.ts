import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { EventTime } from "./google-event-times";

/** The fields an editor sends for an event, as it builds them from its form. */
export interface EditedFields {
  colorId?: string;
  conferenceData?: GoogleEvent["conferenceData"];
  description?: string;
  end: EventTime;
  location?: string;
  start: EventTime;
  summary: string;
}

/** Send only edited details so an occurrence's own values stay local. */
export function seriesEditFields(params: {
  edited: EditedFields;
  occurrence: GoogleEvent;
}): Omit<EditedFields, "summary"> & { summary?: string } {
  const { edited, occurrence } = params;
  const textChange = (
    next: string | undefined,
    previous: string | undefined
  ) =>
    (next?.trim() ?? "") === (previous?.trim() ?? "")
      ? undefined
      : (next?.trim() ?? "");
  return {
    colorId: textChange(edited.colorId, occurrence.colorId),
    conferenceData:
      JSON.stringify(edited.conferenceData) ===
      JSON.stringify(occurrence.conferenceData)
        ? undefined
        : edited.conferenceData,
    description: textChange(edited.description, occurrence.description),
    end: edited.end,
    location: textChange(edited.location, occurrence.location),
    start: edited.start,
    summary: textChange(edited.summary, occurrence.summary),
  };
}

/**
 * The saved event's series pattern: its own rules (the series itself), or
 * its master's (an occurrence carries none), once loaded. Not the
 * draft's, which may add a repeat to a one-off event that isn't a series
 * yet. What a form's repeat is compared with to tell whether it changed.
 */
export function savedSeriesRecurrence(
  event: Pick<GoogleEvent, "recurrence">,
  masterRecurrence: string[] | null | undefined
): string[] {
  return event.recurrence?.length ? event.recurrence : (masterRecurrence ?? []);
}
