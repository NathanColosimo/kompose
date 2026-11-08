import { describe, expect, test } from "bun:test";
import { seriesEditFields, seriesRepeatForEdit } from "./series-edit";

const zone = "America/New_York";

describe("seriesEditFields", () => {
  // A weekly Monday 10:00 series' Nov 16 meeting, moved before to Tue
  // Nov 17 11:00-12:00 and renamed.
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

  test("sends nothing the user didn't change, and its times as they are", () => {
    // The server keeps the series' slot for times the edit leaves alone,
    // and the moved meeting's own move with them.
    expect(
      seriesEditFields({ edited: untouched, occurrence: rescheduled })
    ).toEqual({
      colorId: undefined,
      conferenceData: undefined,
      description: undefined,
      end: rescheduled.end,
      location: undefined,
      start: rescheduled.start,
      summary: undefined,
    });
  });

  test("sends what the user changed, a cleared field included", () => {
    const fields = seriesEditFields({
      edited: {
        ...untouched,
        colorId: undefined,
        description: "",
        summary: "Standup",
      },
      occurrence: rescheduled,
    });
    expect(fields.summary).toBe("Standup");
    expect(fields.description).toBe("");
    // A cleared color is sent empty: left out, it would read as unchanged.
    expect(fields.colorId).toBe("");
    expect(fields.location).toBeUndefined();
  });

  test("sends a new color, and a new meeting", () => {
    const meeting = { conferenceId: "abc-defg-hij" };
    const fields = seriesEditFields({
      edited: { ...untouched, colorId: "7", conferenceData: meeting },
      occurrence: rescheduled,
    });
    expect(fields.colorId).toBe("7");
    expect(fields.conferenceData).toEqual(meeting);
  });
});

describe("seriesRepeatForEdit", () => {
  // Weekly on Mondays from Mon Nov 2, 10:00.
  const seriesRecurrence = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];
  const seriesStart = { dateTime: "2026-11-02T10:00:00-05:00" };
  const monday = {
    end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
    originalStartTime: {
      dateTime: "2026-11-16T10:00:00-05:00",
      timeZone: zone,
    },
    recurringEventId: "series",
    start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
  };
  const repeat = (params: Partial<Parameters<typeof seriesRepeatForEdit>[0]>) =>
    seriesRepeatForEdit({
      edited: { end: monday.end, start: monday.start },
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
      edited: {
        end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
      },
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
      end: { dateTime: "2026-11-17T12:00:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    };
    const changed = repeat({
      edited: { end: movedBefore.end, start: movedBefore.start },
      event: movedBefore,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      recurrenceEdited: true,
    });
    expect(changed.changed).toBe(true);
    expect(changed.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"]);
    expect(changed.countingDay?.toString()).toBe("2026-11-16");
    expect(changed.startDay?.toString()).toBe("2026-11-16");
    // A new end makes its times the user's own: the save starts there.
    const retimed = repeat({
      edited: {
        end: { dateTime: "2026-11-17T12:30:00-05:00", timeZone: zone },
        start: movedBefore.start,
      },
      event: movedBefore,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      recurrenceEdited: true,
    });
    expect(retimed.countingDay?.toString()).toBe("2026-11-17");
    expect(retimed.startDay?.toString()).toBe("2026-11-17");
  });

  test("new times on a meeting moved before restart the series there", () => {
    // Weekly with no day picked, from Monday Nov 2. Nov 16's meeting was
    // moved to Tuesday Nov 17; only its end changes now. A save for the
    // series starts at its new times, on Tuesday, so it reads as Tuesdays.
    const movedBefore = {
      ...monday,
      end: { dateTime: "2026-11-17T12:00:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    };
    const endOnly = repeat({
      edited: {
        end: { dateTime: "2026-11-17T12:30:00-05:00", timeZone: zone },
        start: movedBefore.start,
      },
      event: movedBefore,
      recurrence: ["RRULE:FREQ=WEEKLY"],
      seriesRecurrence: ["RRULE:FREQ=WEEKLY"],
    });
    expect(endOnly.changed).toBe(false);
    expect(endOnly.countingDay?.toString()).toBe("2026-11-17");
    expect(endOnly.startDay?.toString()).toBe("2026-11-17");
  });

  test("a new event's repeat counts from its own start", () => {
    const fresh = repeat({
      edited: {
        end: { dateTime: "2026-11-18T10:30:00-05:00" },
        start: { dateTime: "2026-11-18T10:00:00-05:00" },
      },
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
