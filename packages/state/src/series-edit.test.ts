import { describe, expect, test } from "bun:test";
import { savedSeriesRecurrence, seriesEditFields } from "./series-edit";

const zone = "America/New_York";

describe("seriesEditFields", () => {
  // A weekly Monday 10:00 series' Nov 16 meeting, moved before to Tue
  // Nov 17 11:00-12:00 and renamed.
  const rescheduled = {
    colorId: "5",
    id: "series_20261116",
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

  test("an occurrence's own stray spaces aren't a change", () => {
    const spaced = {
      ...rescheduled,
      description: "Agenda\n",
      summary: "Moved standup ",
    };
    const fields = seriesEditFields({
      edited: { ...untouched, description: "Agenda", summary: "Moved standup" },
      occurrence: spaced,
    });
    expect(fields.summary).toBeUndefined();
    expect(fields.description).toBeUndefined();
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

describe("savedSeriesRecurrence", () => {
  const weekly = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];

  test("is the series' own rules, from its master for an occurrence", () => {
    // An occurrence carries no rules of its own: its master has them.
    expect(savedSeriesRecurrence({ recurrence: undefined }, weekly)).toEqual(
      weekly
    );
    // The series itself has its own.
    const daily = ["RRULE:FREQ=DAILY"];
    expect(savedSeriesRecurrence({ recurrence: daily }, weekly)).toEqual(daily);
  });

  test("is none for a one-off event, whatever its draft adds", () => {
    // Not the draft's: a repeat added to a one-off event isn't a series yet.
    expect(savedSeriesRecurrence({ recurrence: [] }, undefined)).toEqual([]);
    expect(savedSeriesRecurrence({}, null)).toEqual([]);
  });
});
