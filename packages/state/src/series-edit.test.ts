import { describe, expect, test } from "bun:test";
import { seriesEditFields, seriesRepeatForEdit } from "./series-edit";

const zone = "America/New_York";

describe("seriesEditFields", () => {
  // A weekly Monday 10:00-10:30 series; its Nov 16 meeting was moved
  // before to Tue Nov 17 11:00-12:00 and renamed.
  const series = {
    end: { dateTime: "2026-11-02T10:30:00-05:00", timeZone: zone },
    start: { dateTime: "2026-11-02T10:00:00-05:00", timeZone: zone },
  };
  const rescheduled = {
    colorId: "5",
    description: "Agenda",
    end: { dateTime: "2026-11-17T12:00:00-05:00", timeZone: zone },
    location: "Room 1",
    originalStartTime: {
      dateTime: "2026-11-16T10:00:00-05:00",
      timeZone: zone,
    },
    start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    summary: "Moved standup",
  };
  // What the editor sends when the user changes nothing.
  const untouched = {
    colorId: "5",
    description: "Agenda",
    end: rescheduled.end,
    location: "Room 1",
    start: rescheduled.start,
    summary: "Moved standup",
  };

  test("sends nothing the user didn't change, and keeps the series' slot and length", () => {
    expect(
      seriesEditFields({ edited: untouched, occurrence: rescheduled, series })
    ).toEqual({
      colorId: undefined,
      conferenceData: undefined,
      description: undefined,
      end: { dateTime: "2026-11-16T15:30:00Z", timeZone: zone },
      location: undefined,
      start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      summary: undefined,
    });
  });

  test("sends what the user changed, a cleared field included", () => {
    const fields = seriesEditFields({
      edited: { ...untouched, description: "", summary: "Standup" },
      occurrence: rescheduled,
      series,
    });
    expect(fields.summary).toBe("Standup");
    expect(fields.description).toBe("");
    expect(fields.location).toBeUndefined();
  });

  test("a new end alone keeps the slot and takes the new length", () => {
    const fields = seriesEditFields({
      edited: {
        ...untouched,
        end: { dateTime: "2026-11-17T11:45:00-05:00", timeZone: zone },
      },
      occurrence: rescheduled,
      series,
    });
    expect(fields.start).toEqual({
      dateTime: "2026-11-16T10:00:00-05:00",
      timeZone: zone,
    });
    expect(fields.end).toEqual({
      dateTime: "2026-11-16T15:45:00Z",
      timeZone: zone,
    });
  });

  test("a new start is the user's own", () => {
    const start = { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone };
    const end = { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone };
    const fields = seriesEditFields({
      edited: { ...untouched, end, start },
      occurrence: rescheduled,
      series,
    });
    expect(fields.start).toEqual(start);
    expect(fields.end).toEqual(end);
  });

  test("an all-day series keeps its days", () => {
    const allDay = {
      end: { date: "2026-11-18" },
      originalStartTime: { date: "2026-11-16" },
      start: { date: "2026-11-17" },
      summary: "Offsite",
    };
    const fields = seriesEditFields({
      edited: { end: allDay.end, start: allDay.start, summary: "Offsite" },
      occurrence: allDay,
      series: { end: { date: "2026-11-03" }, start: { date: "2026-11-02" } },
    });
    expect(fields.start).toEqual({ date: "2026-11-16" });
    expect(fields.end).toEqual({ date: "2026-11-17" });
  });

  test("a regular occurrence left alone sends its own times", () => {
    const regular = {
      ...rescheduled,
      end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
      start: rescheduled.originalStartTime,
    };
    const fields = seriesEditFields({
      edited: { ...untouched, end: regular.end, start: regular.start },
      occurrence: regular,
      series,
    });
    expect(fields.start).toEqual(regular.start);
    expect(fields.end).toEqual({
      dateTime: "2026-11-16T15:30:00Z",
      timeZone: zone,
    });
  });
});

describe("seriesRepeatForEdit", () => {
  // Weekly on Mondays from Mon Nov 2, 10:00.
  const seriesRecurrence = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];
  const seriesStart = { dateTime: "2026-11-02T10:00:00-05:00" };
  const monday = {
    originalStartTime: {
      dateTime: "2026-11-16T10:00:00-05:00",
      timeZone: zone,
    },
    recurringEventId: "series",
    start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
  };
  const repeat = (params: Partial<Parameters<typeof seriesRepeatForEdit>[0]>) =>
    seriesRepeatForEdit({
      editedStart: monday.start,
      event: monday,
      recurrence: seriesRecurrence,
      recurrenceEdited: false,
      seriesRecurrence,
      seriesStart,
      timeZone: zone,
      ...params,
    });

  test("a day moved in this edit shows the rule the save sends, from that day", () => {
    const moved = repeat({
      editedStart: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
    });
    expect(moved.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
    expect(moved.changed).toBe(false);
    expect(moved.countingDay?.toString()).toBe("2026-11-17");
    expect(moved.startDay?.toString()).toBe("2026-11-17");
  });

  test("left where it is, the series' own rule from its first day", () => {
    const kept = repeat({});
    expect(kept.recurrence).toEqual(seriesRecurrence);
    expect(kept.countingDay?.toString()).toBe("2026-11-02");
    expect(kept.startDay?.toString()).toBe("2026-11-16");
  });

  test("a meeting moved before saves from its place in the series", () => {
    const movedBefore = {
      ...monday,
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    };
    const changed = repeat({
      editedStart: movedBefore.start,
      event: movedBefore,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      recurrenceEdited: true,
    });
    expect(changed.changed).toBe(true);
    expect(changed.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"]);
    expect(changed.countingDay?.toString()).toBe("2026-11-16");
    expect(changed.startDay?.toString()).toBe("2026-11-16");
  });

  test("a new event's repeat counts from its own start", () => {
    const fresh = repeat({
      editedStart: { dateTime: "2026-11-18T10:00:00-05:00" },
      event: null,
      recurrence: ["RRULE:FREQ=WEEKLY"],
      recurrenceEdited: true,
      seriesRecurrence: undefined,
      seriesStart: undefined,
    });
    expect(fresh.recurrence).toEqual(["RRULE:FREQ=WEEKLY"]);
    expect(fresh.countingDay?.toString()).toBe("2026-11-18");
  });
});
