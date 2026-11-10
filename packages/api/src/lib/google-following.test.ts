import { describe, expect, test } from "bun:test";
import {
  splitAddedDays,
  truncateRecurrenceForFollowing,
} from "@kompose/google-cal/recurrence-utils";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { Exit } from "effect";
import {
  BASE32HEX_ID,
  edit,
  failure,
  fakeGoogle,
  nov16,
  occurrenceOf,
  type Request,
  refusalOf,
  run,
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

// This and following: a new series created first, occurrences carried
// onto it, the old series cut, and a failed split rolled back.

describe("This and following", () => {
  test("creates the new series, then ends the old one the second before", async () => {
    const google = fakeGoogle(weekly);
    // Written without an offset, in its zone.
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: zone },
        summary: "Planning (new room)",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.method).toBe("POST");
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
      summary: "Planning (new room)",
    });
    // Its own id (Google's base32hex), never the old series' iCalUID.
    expect(String(created?.body?.id)).toMatch(BASE32HEX_ID);
    expect(created?.body).not.toHaveProperty("iCalUID");
    expect(cut?.method).toBe("PUT");
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
    ]);
    expect(cut?.body?.summary).toBe("Planning");
    expect(google.writes()).toHaveLength(2);
  });

  test("a start written in another zone, without an offset, keeps its moment", async () => {
    // 09:00 Tokyo on Nov 23 is 19:00 New York on Nov 22 (the series' zone).
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: "Asia/Tokyo" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: "Asia/Tokyo" },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      end: { dateTime: "2026-11-22T19:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-22T19:00:00-05:00", timeZone: zone },
    });
  });

  test("carries a later moved occurrence into the new series", async () => {
    // Nov 30 was moved to 12:00 and renamed on its own; the series from
    // Nov 16 moves to 15:00. Nov 30 keeps its 12:00 and its title, now
    // on the new series' Nov 30 (its 15:00 slot there).
    const moved = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
        end: "2026-11-30T12:30:00-05:00",
        start: "2026-11-30T12:00:00-05:00",
      }),
      summary: "Planning (long)",
    };
    const google = fakeGoogle(weekly, [moved]);
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-16T15:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T15:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, carried, cut] = google.writes();
    const newId = String(created?.body?.id);
    const lookup = google.requests.find((request) =>
      request.url.pathname.endsWith(`/events/${newId}/instances`)
    );
    expect(lookup?.url.searchParams.get("originalStart")).toBe(
      "2026-11-30T15:00:00-05:00"
    );
    expect(carried?.method).toBe("PUT");
    expect(carried?.url.pathname).toEndWith(
      `/events/${newId}_20261130T200000Z`
    );
    expect(carried?.body).toMatchObject({
      end: { dateTime: "2026-11-30T12:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-30T12:00:00-05:00", timeZone: zone },
      summary: "Planning (long)",
    });
    // The old series is cut only once the new one holds it.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(3);
  });

  test("refuses, before writing, when a moved occurrence has no place in the new series", async () => {
    // Nov 23 was moved on its own; from Nov 16 the series becomes every
    // other week, so it has no Nov 23 to keep it on.
    const moved = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T11:30:00-05:00",
      start: "2026-11-23T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      await refusalOf(
        edit("following", nov16, {
          recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"],
        })
      )
    ).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
        seriesOnly: true,
      },
      // One occurrence can't take a new repeat.
      message:
        "This would undo what was changed or deleted on single occurrences (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("from a moved occurrence, applies only what the user changed", async () => {
    // Nov 16 was moved to Tue Nov 17 11:00 and renamed on its own. Opened
    // there, the user only adds Thursdays: the series keeps its Monday
    // 9:00 and title from Nov 16, and Nov 16 keeps its own move and name.
    const opened = {
      ...occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
        end: "2026-11-17T11:30:00-05:00",
        start: "2026-11-17T11:00:00-05:00",
      }),
      summary: "Planning (moved)",
    };
    const google = fakeGoogle(weekly, [opened]);
    const exit = await run(
      edit("following", opened, {
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
      summary: "Planning (moved)",
    });
  });

  test("from a moved occurrence, a new end alone keeps the series' slot", async () => {
    // Nov 16 was moved to Tue Nov 17 11:00-11:30 on its own; only its end
    // goes to 12:00. The new series stays on Mondays at 9:00, an hour
    // long, and Nov 16 keeps its own start with the new end.
    const opened = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", opened, {
            end: { dateTime: "2026-11-17T12:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-16T10:00:00-05:00" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-16T09:00:00-05:00" },
    });
    expect(carried?.body).toMatchObject({
      end: { dateTime: "2026-11-17T12:00:00-05:00" },
      start: { dateTime: "2026-11-17T11:00:00-05:00" },
    });
  });

  test("carries an occurrence's own reminder and attachment", async () => {
    // Nov 30 has a reminder and a file of its own; from Nov 16 renamed.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        attachments: [{ fileUrl: "https://example.com/agenda" }],
        reminders: {
          overrides: [{ method: "popup", minutes: 5 }],
          useDefault: false,
        },
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("following", nov16, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const carried = google.writes()[1];
    expect(carried?.url.searchParams.get("supportsAttachments")).toBe("true");
    expect(carried?.body).toMatchObject({
      attachments: [{ fileUrl: "https://example.com/agenda" }],
      reminders: { overrides: [{ method: "popup", minutes: 5 }] },
      summary: "Planning (new)",
    });
  });

  test("a move to another day carries a deleted occurrence's skip to the new day", async () => {
    // Nov 30 was deleted on its own; from Nov 16 the series moves to
    // Tuesdays, so the skip moves to Tue Dec 1, as a changed Nov 30 would.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE:20261201T140000Z",
    ]);
  });

  test("an hourly series moved a day on keeps a live meeting carried onto a deleted one's place", async () => {
    // Hourly from Nov 9 9:00, Nov 10 11:00 deleted; from Nov 9 10:00 moved
    // to Nov 10 10:00. Nov 9 11:00 is carried to Nov 10 11:00: no skip
    // there.
    const hourly: Event = { ...weekly, recurrence: ["RRULE:FREQ=HOURLY"] };
    const google = fakeGoogle(hourly, [
      {
        ...occurrenceOf(hourly, "2026-11-10T11:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(hourly, "2026-11-09T10:00:00-05:00"), {
            end: { dateTime: "2026-11-10T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-10T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual(["RRULE:FREQ=HOURLY"]);
  });

  describe("Mondays and Wednesdays made Wednesdays from Mon Nov 16", () => {
    // Mon Nov 23 deleted on its own. Its place in the new series is Wed
    // Nov 25, which the Wednesday meeting there still holds.
    const monWed: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    };
    const toWednesdays = () =>
      edit("following", nov16, {
        end: { dateTime: "2026-11-18T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
        start: { dateTime: "2026-11-18T09:00:00-05:00", timeZone: zone },
      });
    const nov23 = {
      ...occurrenceOf(monWed, "2026-11-23T09:00:00-05:00"),
      status: "cancelled",
    };

    test("keeps Wed Nov 25", async () => {
      const google = fakeGoogle(monWed, [nov23]);
      expect(Exit.isSuccess(await run(toWednesdays()))).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=WE",
      ]);
    });

    test("puts back Wed Nov 25's own rename", async () => {
      const google = fakeGoogle(monWed, [
        nov23,
        {
          ...occurrenceOf(monWed, "2026-11-25T09:00:00-05:00"),
          summary: "Planning (Nov 25)",
        },
      ]);
      expect(Exit.isSuccess(await run(toWednesdays()))).toBe(true);
      const [created, carried] = google.writes();
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20261125T140000Z`
      );
    });
  });

  test("first Mondays and third Tuesdays made third Tuesdays keep a live meeting a deleted one's place shares", async () => {
    // From Oct 5; Dec 15 deleted. From Nov 2 moved to Tue Nov 17,
    // BYDAY=3TU: December's first meeting, Dec 7, is now Dec 15. Dec 15
    // stays on.
    const monthly: Event = {
      ...weekly,
      end: { dateTime: "2026-10-05T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO,3TU"],
      start: { dateTime: "2026-10-05T09:00:00-04:00", timeZone: zone },
    };
    const google = fakeGoogle(monthly, [
      {
        ...occurrenceOf(monthly, "2026-12-15T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(monthly, "2026-11-02T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
              recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3TU"],
              start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;BYDAY=3TU",
    ]);
  });

  test("a week-number rule carries a renamed meeting to its new time", async () => {
    // Weeks 46 to 49 on Mondays (a rule only other apps write); Nov 30
    // renamed. From Nov 16 moved to 10:00: the new series meets Nov 30 at
    // 10:00, so its rename is put back there.
    const byWeek: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;BYWEEKNO=46,47,48,49;BYDAY=MO"],
    };
    const google = fakeGoogle(byWeek, [
      {
        ...occurrenceOf(byWeek, "2026-11-30T09:00:00-05:00"),
        summary: "Planning (Nov 30)",
      },
    ]);
    const exit = await run(
      edit("following", occurrenceOf(byWeek, "2026-11-16T09:00:00-05:00"), {
        end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261130T150000Z`
    );
    expect(carried?.body).toMatchObject({ summary: "Planning (Nov 30)" });
  });

  describe("first and third Mondays made second and third Tuesdays", () => {
    // From Oct 5; from Nov 2 moved to Tue Nov 10, BYDAY=2TU,3TU. December's
    // first meeting (Dec 7) is now Dec 8, its third (Dec 21) Dec 15.
    const monthly: Event = {
      ...weekly,
      end: { dateTime: "2026-10-05T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO,3MO"],
      start: { dateTime: "2026-10-05T09:00:00-04:00", timeZone: zone },
    };
    const toTuesdays = () =>
      edit("following", occurrenceOf(monthly, "2026-11-02T09:00:00-05:00"), {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2TU,3TU"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      });

    test("skips a deleted first Monday on its month's first new meeting", async () => {
      const google = fakeGoogle(monthly, [
        {
          ...occurrenceOf(monthly, "2026-12-07T09:00:00-05:00"),
          status: "cancelled",
        },
      ]);
      expect(Exit.isSuccess(await run(toTuesdays()))).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=MONTHLY;BYDAY=2TU,3TU",
        "EXDATE:20261208T140000Z",
      ]);
    });

    test("puts a renamed third Monday back on its month's third new meeting beside the deleted first", async () => {
      const google = fakeGoogle(monthly, [
        {
          ...occurrenceOf(monthly, "2026-12-07T09:00:00-05:00"),
          status: "cancelled",
        },
        {
          ...occurrenceOf(monthly, "2026-12-21T09:00:00-05:00"),
          summary: "Planning (Dec 21)",
        },
      ]);
      expect(Exit.isSuccess(await run(toTuesdays()))).toBe(true);
      const [created, carried] = google.writes();
      expect(created?.body?.recurrence).toContain("EXDATE:20261208T140000Z");
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20261215T140000Z`
      );
    });
  });

  test("a rule skip where nothing met stays as written on a rename", async () => {
    // Monthly on the 9th at 9:00, with a skip at Jan 9 10:00 where no
    // meeting is (another app wrote it); renamed from Dec 9, it has no
    // meeting to follow, and Jan 9's 9:00 meeting stays.
    const monthly: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=MONTHLY", "EXDATE:20270109T150000Z"],
    };
    const google = fakeGoogle(monthly);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(monthly, "2026-12-09T09:00:00-05:00"),
            {
              summary: "Planning (renamed)",
            }
          )
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY",
      "EXDATE:20270109T150000Z",
    ]);
  });

  test("a rule skip where nothing met cancels no meeting the split moves there", async () => {
    // Mondays with a skip on Tue Nov 17 9:00, where no meeting was; from
    // Nov 16 moved to Tuesdays: Nov 17 is the new series' first meeting.
    const stale: Event = {
      ...weekly,
      recurrence: [...(weekly.recurrence ?? []), "EXDATE:20261117T140000Z"],
    };
    const google = fakeGoogle(stale);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(stale, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
    ]);
  });

  test("carries a meeting made all day on its own when the split makes the series all day", async () => {
    // Nov 30 made all day and renamed on its own; from Nov 16 the series is
    // made all day too: Nov 30 keeps its name on the new series' Nov 30.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        end: { date: "2026-12-01" },
        start: { date: "2026-11-30" },
        summary: "Planning (Nov 30)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { date: "2026-11-17" },
            start: { date: "2026-11-16" },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261130`
    );
    expect(carried?.body).toMatchObject({
      start: { date: "2026-11-30" },
      summary: "Planning (Nov 30)",
    });
  });

  test("carries a meeting made timed on its own when the split makes the series timed", async () => {
    // All day Mondays; Nov 30 made 10:00 and renamed on its own; from Nov
    // 16 the series is made 9:00: Nov 30 keeps its 10:00 and its name.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      start: { date: "2026-11-09" },
    };
    const google = fakeGoogle(allDay, [
      {
        ...occurrenceOf(allDay, "2026-11-30"),
        end: { dateTime: "2026-11-30T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-30T10:00:00-05:00", timeZone: zone },
        summary: "Planning (Nov 30)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(allDay, "2026-11-16"), {
            end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261130T140000Z`
    );
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-30T10:00:00-05:00" },
      summary: "Planning (Nov 30)",
    });
  });

  describe("a move past later meetings", () => {
    // A changed meeting the move passes lands where a later meeting does:
    // carrying it would overwrite that one, so the save is refused.
    test("refuses a meeting moved on its own whose place is a later one's", async () => {
      // Nov 23 moved to Wed Nov 25 10:00; from Nov 16 moved to Nov 30.
      const google = fakeGoogle(weekly, [
        occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
          end: "2026-11-25T10:30:00-05:00",
          start: "2026-11-25T10:00:00-05:00",
        }),
      ]);
      expect(
        await refusalOf(
          edit("following", nov16, {
            end: { dateTime: "2026-11-30T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: ["2026-11-23T09:00:00-05:00"],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("refuses a renamed meeting whose place is a later one's", async () => {
      // Nov 23 renamed; from Nov 16 moved to Dec 7.
      const google = fakeGoogle(weekly, [
        {
          ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
          summary: "Planning (Nov 23)",
        },
      ]);
      expect(
        await refusalOf(
          edit("following", nov16, {
            end: { dateTime: "2026-12-07T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-12-07T09:00:00-05:00", timeZone: zone },
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: ["2026-11-23T09:00:00-05:00"],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("carries a renamed meeting the move leaves on its own day", async () => {
      // Dec 7 renamed; from Nov 16 moved to Nov 30. Nov 23's meeting moves
      // onto Dec 7, but Dec 7 keeps its own day: one meeting there either
      // way, with its name.
      const google = fakeGoogle(weekly, [
        {
          ...occurrenceOf(weekly, "2026-12-07T09:00:00-05:00"),
          summary: "Planning (Dec 7)",
        },
      ]);
      expect(
        Exit.isSuccess(
          await run(
            edit("following", nov16, {
              end: { dateTime: "2026-11-30T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
            })
          )
        )
      ).toBe(true);
      const [created, carried] = google.writes();
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20261207T140000Z`
      );
      expect(carried?.body?.summary).toBe("Planning (Dec 7)");
    });

    // Saturdays and Sundays at 9:00; from a Saturday moved to the Sunday,
    // Sundays only. A renamed Saturday is carried a day on, onto a
    // Sunday's place, measured by the clock across a clock change too.
    const weekends = (start: string): Event => ({
      ...weekly,
      end: { dateTime: start.replace("T09:00", "T09:30"), timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SA,SU"],
      start: { dateTime: start, timeZone: zone },
    });

    test("refuses a renamed Saturday carried onto a Sunday across the spring clock change", async () => {
      // Mar 13 renamed; from Mar 6 moved to Sun Mar 7. Mar 13 to Mar 14 is
      // 23 hours, but a day by the clock: Mar 14's meeting is there.
      const series = weekends("2027-02-27T09:00:00-05:00");
      const google = fakeGoogle(series, [
        {
          ...occurrenceOf(series, "2027-03-13T09:00:00-05:00"),
          summary: "Planning (Mar 13)",
        },
      ]);
      expect(
        await refusalOf(
          edit("following", occurrenceOf(series, "2027-03-06T09:00:00-05:00"), {
            end: { dateTime: "2027-03-07T09:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
            start: { dateTime: "2027-03-07T09:00:00-05:00", timeZone: zone },
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: ["2027-03-13T09:00:00-05:00"],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("carries a renamed Saturday less than a day on across the fall clock change", async () => {
      // From Sat Oct 30 9:00 moved to Sun Oct 31 8:30, Sundays only: each
      // Saturday lands 23.5 hours on by the clock, its own place. Nov 6 to
      // Nov 7 8:30 is 24.5 hours, still its own place.
      const series = weekends("2027-10-02T09:00:00-04:00");
      const google = fakeGoogle(series, [
        {
          ...occurrenceOf(series, "2027-11-06T09:00:00-04:00"),
          summary: "Planning (Nov 6)",
        },
      ]);
      expect(
        Exit.isSuccess(
          await run(
            edit(
              "following",
              occurrenceOf(series, "2027-10-30T09:00:00-04:00"),
              {
                end: { dateTime: "2027-10-31T09:00:00-04:00", timeZone: zone },
                recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
                start: {
                  dateTime: "2027-10-31T08:30:00-04:00",
                  timeZone: zone,
                },
              }
            )
          )
        )
      ).toBe(true);
      const [created, carried] = google.writes();
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20271107T133000Z`
      );
      expect(carried?.body?.summary).toBe("Planning (Nov 6)");
    });

    test("refuses a renamed monthly meeting whose place is a later one's", async () => {
      // The third Monday from Oct 19, Dec 21 renamed; from Nov 16 moved to
      // Jan 18: Dec 21's place, two months on, is Feb 15's own.
      const monthly: Event = {
        ...weekly,
        end: { dateTime: "2026-10-19T09:30:00-04:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3MO"],
        start: { dateTime: "2026-10-19T09:00:00-04:00", timeZone: zone },
      };
      const google = fakeGoogle(monthly, [
        {
          ...occurrenceOf(monthly, "2026-12-21T09:00:00-05:00"),
          summary: "Planning (Dec 21)",
        },
      ]);
      expect(
        await refusalOf(
          edit(
            "following",
            occurrenceOf(monthly, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2027-01-18T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2027-01-18T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      ).toMatchObject({
        data: {
          originalStarts: ["2026-12-21T09:00:00-05:00"],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });
  });

  describe("a monthly series moved into the next month", () => {
    // Each later meeting lands as many months on as the split moved: the
    // 28th moved to Dec 2 puts Dec 28 on Jan 2 and Feb 28 on Mar 2.
    const on28th: Event = {
      ...weekly,
      end: { dateTime: "2026-10-28T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=28"],
      start: { dateTime: "2026-10-28T09:00:00-04:00", timeZone: zone },
    };
    const toThe2nd = () =>
      edit("following", occurrenceOf(on28th, "2026-11-28T09:00:00-05:00"), {
        end: { dateTime: "2026-12-02T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=2"],
        start: { dateTime: "2026-12-02T09:00:00-05:00", timeZone: zone },
      });

    test("skips each deleted meeting on its place a month on", async () => {
      const google = fakeGoogle(on28th, [
        {
          ...occurrenceOf(on28th, "2026-12-28T09:00:00-05:00"),
          status: "cancelled",
        },
        {
          ...occurrenceOf(on28th, "2027-02-28T09:00:00-05:00"),
          status: "cancelled",
        },
      ]);
      expect(Exit.isSuccess(await run(toThe2nd()))).toBe(true);
      const written = JSON.stringify(google.writes()[0]?.body?.recurrence);
      expect(written).toContain("20270102T140000Z");
      expect(written).toContain("20270302T140000Z");
      expect(written).not.toContain("20270202T140000Z");
    });

    test("puts a renamed meeting back on its place a month on", async () => {
      const google = fakeGoogle(on28th, [
        {
          ...occurrenceOf(on28th, "2026-12-28T09:00:00-05:00"),
          summary: "Planning (Dec 28)",
        },
      ]);
      expect(Exit.isSuccess(await run(toThe2nd()))).toBe(true);
      const [created, carried] = google.writes();
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20270102T140000Z`
      );
    });

    test("skips a deleted third Monday on the next month's first Monday", async () => {
      // The third Monday from Oct 19; from Nov 16 moved to the first
      // Monday, Dec 7. Dec 21 was deleted: January's first Monday goes.
      const monthly: Event = {
        ...weekly,
        end: { dateTime: "2026-10-19T09:30:00-04:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3MO"],
        start: { dateTime: "2026-10-19T09:00:00-04:00", timeZone: zone },
      };
      const google = fakeGoogle(monthly, [
        {
          ...occurrenceOf(monthly, "2026-12-21T09:00:00-05:00"),
          status: "cancelled",
        },
      ]);
      expect(
        Exit.isSuccess(
          await run(
            edit(
              "following",
              occurrenceOf(monthly, "2026-11-16T09:00:00-05:00"),
              {
                end: { dateTime: "2026-12-07T09:30:00-05:00", timeZone: zone },
                recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO"],
                start: {
                  dateTime: "2026-12-07T09:00:00-05:00",
                  timeZone: zone,
                },
              }
            )
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=MONTHLY;BYDAY=1MO",
        "EXDATE:20270104T140000Z",
      ]);
    });
  });

  describe("a monthly series moved to another weekday of its month", () => {
    // The third Monday from Oct 19, Dec 21's deleted or renamed on its own;
    // from Nov 16 it moves to the third Tuesday. December's meeting is
    // now Tue Dec 15, not a day after Dec 21.
    const monthly: Event = {
      ...weekly,
      end: { dateTime: "2026-10-19T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3MO"],
      start: { dateTime: "2026-10-19T09:00:00-04:00", timeZone: zone },
    };
    const dec21 = occurrenceOf(monthly, "2026-12-21T09:00:00-05:00");
    const toThirdTuesday = () =>
      edit("following", occurrenceOf(monthly, "2026-11-16T09:00:00-05:00"), {
        end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3TU"],
        start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
      });

    test("carries a deleted one's skip to that month's new meeting", async () => {
      const google = fakeGoogle(monthly, [{ ...dec21, status: "cancelled" }]);
      expect(Exit.isSuccess(await run(toThirdTuesday()))).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=MONTHLY;BYDAY=3TU",
        "EXDATE:20261215T140000Z",
      ]);
    });

    test("puts a renamed one back on that month's new meeting", async () => {
      const google = fakeGoogle(monthly, [{ ...dec21, summary: "Party" }]);
      expect(Exit.isSuccess(await run(toThirdTuesday()))).toBe(true);
      const [created, carried] = google.writes();
      expect(carried?.url.pathname).toEndWith(
        `/events/${String(created?.body?.id)}_20261215T140000Z`
      );
      expect(carried?.body).toMatchObject({ summary: "Party" });
    });
  });

  describe("from a form toggled to or from all day, sending both forms", () => {
    test("made timed, the new series takes the time", async () => {
      // Mondays all day; from Nov 16 set to 9:00 (the form keeps the date).
      const allDay: Event = {
        ...weekly,
        end: { date: "2026-11-10" },
        start: { date: "2026-11-09" },
      };
      const opened: Event = {
        ...allDay,
        end: { date: "2026-11-17" },
        id: "series_20261116",
        originalStartTime: { date: "2026-11-16" },
        recurrence: undefined,
        recurringEventId: "series",
        start: { date: "2026-11-16" },
      };
      const google = fakeGoogle(allDay, [opened]);
      expect(
        Exit.isSuccess(
          await run(
            edit("following", opened, {
              end: {
                date: "2026-11-17",
                dateTime: "2026-11-16T09:30:00-05:00",
                timeZone: zone,
              },
              start: {
                date: "2026-11-16",
                dateTime: "2026-11-16T09:00:00-05:00",
                timeZone: zone,
              },
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.start).toEqual({
        dateTime: "2026-11-16T09:00:00-05:00",
        timeZone: zone,
      });
    });

    test("made all day, a renamed one is carried to its day", async () => {
      // Nov 30 renamed on its own; from Nov 16 made all day (the form keeps
      // the date-time).
      const google = fakeGoogle(weekly, [
        {
          ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
          summary: "Own",
        },
      ]);
      expect(
        Exit.isSuccess(
          await run(
            edit("following", nov16, {
              end: { ...nov16.end, date: "2026-11-17" },
              start: { ...nov16.start, date: "2026-11-16" },
            })
          )
        )
      ).toBe(true);
      const [created, carried] = google.writes();
      expect(created?.body?.start).toEqual({ date: "2026-11-16" });
      expect(carried?.body).toMatchObject({ summary: "Own" });
    });
  });

  test("carries a renamed occurrence on its own slot under a rule not read here", async () => {
    // Monday of weeks 46 to 49 (a rule not read here), Nov 30 renamed on
    // its own; from Nov 16, a new location only.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46,47,48,49;BYDAY=MO";
    const series: Event = { ...weekly, recurrence: [rule] };
    const google = fakeGoogle(series, [
      { ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"), summary: "Own" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            location: "Room 2",
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261130T140000Z`
    );
    expect(carried?.body).toMatchObject({ summary: "Own" });
  });

  test("a new repeat sent alone keeps the series' skips after the split", async () => {
    // Nov 30 skipped in the rule; from Nov 16, Mondays become Mondays and
    // Thursdays, the rule sent without the skip.
    const google = fakeGoogle({
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261130T140000Z"],
    });
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
      "EXDATE:20261130T140000Z",
    ]);
  });

  test("a new repeat sent alone keeps the series' added days after the split", async () => {
    // Mondays plus an added Wed Nov 25; from Nov 16, Mondays become
    // Mondays and Thursdays, the rule sent without the added day.
    const google = fakeGoogle({
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261125T090000",
      ],
    });
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
      "RDATE;TZID=America/New_York:20261125T090000",
    ]);
  });

  test("a new repeat sent alone drops a deleted added day after the split", async () => {
    // As above, Nov 25 deleted on its own: it shows nothing, so the rule
    // sent without it leaves it out.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261125T090000",
      ],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-25T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
          })
        )
      )
    ).toBe(true);
    expect(JSON.stringify(google.writes()[0]?.body?.recurrence)).not.toContain(
      "RDATE"
    );
  });

  test("a new time across midnight moves later meetings by as much", async () => {
    // Daily 23:30; Nov 20 deleted and Nov 22 renamed on their own. From
    // Nov 16, moved to Nov 17 00:30: each later meeting is an hour later,
    // the next day.
    const late: Event = {
      ...weekly,
      end: { dateTime: "2026-11-09T23:59:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-11-09T23:30:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(late, [
      {
        ...occurrenceOf(late, "2026-11-20T23:30:00-05:00"),
        status: "cancelled",
      },
      { ...occurrenceOf(late, "2026-11-22T23:30:00-05:00"), summary: "Own" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(late, "2026-11-16T23:30:00-05:00"), {
            end: { dateTime: "2026-11-17T00:59:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-17T00:30:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20261121T053000Z",
    ]);
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261123T053000Z`
    );
  });

  test("a move to a day the rule doesn't meet skips the moved meeting's old slot", async () => {
    // From Mon Nov 16, moved to Sun Nov 15 with the Monday rule kept: the
    // new series meets at its Sunday start, so its Monday Nov 16 meeting
    // (the one just moved) is skipped.
    const google = fakeGoogle(weekly);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-15T09:30:00-05:00", timeZone: zone },
            recurrence: weekly.recurrence,
            start: { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261116T140000Z"],
      start: { dateTime: "2026-11-15T09:00:00-05:00" },
    });
  });

  test("a move to a day and time the rule doesn't meet skips the moved meeting's place", async () => {
    // The same, moved to Sun Nov 15 at 10:00: the new series meets Mondays
    // at 10:00, so Mon Nov 16 at 10:00 is the one skipped.
    const google = fakeGoogle(weekly);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-15T10:30:00-05:00", timeZone: zone },
            recurrence: weekly.recurrence,
            start: { dateTime: "2026-11-15T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261116T150000Z",
    ]);
  });

  test("a move to another day takes the rule's own skip with its meeting", async () => {
    // Nov 30 skipped in the rule; from Nov 16 the series moves to Tuesdays.
    const skipped: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261130T140000Z"],
    };
    const google = fakeGoogle(skipped);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(skipped, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
              recurrence: [
                "RRULE:FREQ=WEEKLY;BYDAY=TU",
                "EXDATE:20261130T140000Z",
              ],
              start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE:20261201T140000Z",
    ]);
  });

  test("a move onto a skipped meeting doesn't skip the meeting saved there", async () => {
    // Nov 30 skipped in the rule; from Nov 16 moved to Nov 30 itself.
    const skipped: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261130T140000Z"],
    };
    const google = fakeGoogle(skipped);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(skipped, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-30T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-30T09:00:00-05:00" },
    });
  });

  test("made all day, a deleted occurrence's skip is its date", async () => {
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { date: "2026-11-17" },
            start: { date: "2026-11-16" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;VALUE=DATE:20261130",
    ]);
  });

  test("a move to other days made all day places a deleted occurrence by day", async () => {
    // Nov 30 deleted on its own; from Nov 16 moved to Tuesdays, all day.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { date: "2026-11-18" },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
            start: { date: "2026-11-17" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;VALUE=DATE:20261201",
    ]);
  });

  test("a deleted occurrence's skip doesn't land on an added meeting kept", async () => {
    // Mondays 9:00 plus an added Tue Dec 1 10:00; Nov 30 deleted. From Nov
    // 16 moved to Tuesdays at 10:00: Nov 30's place is the added Dec 1,
    // which stays.
    const added: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T100000",
      ],
    };
    const google = fakeGoogle(added, [
      {
        ...occurrenceOf(added, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(added, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "RDATE;TZID=America/New_York:20261201T100000",
            ],
            start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "RDATE;TZID=America/New_York:20261201T100000",
    ]);
  });

  test("a move to a later day the rule doesn't meet keeps the meeting saved", async () => {
    // From Mon Nov 16 to Tue Nov 17, the Monday rule kept.
    const google = fakeGoogle(weekly);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
            recurrence: weekly.recurrence,
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
    ]);
  });

  test("refuses to carry a changed occurrence onto an added meeting kept", async () => {
    // Mondays 9:00 plus an added Tue Dec 1 9:00; Nov 30 moved to 13:00 on
    // its own. From Nov 16 moved to Tuesdays: Nov 30's place is Dec 1,
    // which the added meeting holds.
    const added: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T090000",
      ],
    };
    const google = fakeGoogle(added, [
      occurrenceOf(added, "2026-11-30T09:00:00-05:00", {
        end: "2026-11-30T13:30:00-05:00",
        start: "2026-11-30T13:00:00-05:00",
      }),
    ]);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(added, "2026-11-16T09:00:00-05:00"), {
          end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
          recurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=TU",
            "RDATE;TZID=America/New_York:20261201T090000",
          ],
          start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-30T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("Repeat: None from an occurrence is refused while a later one has changes", async () => {
    // Nov 30 renamed on its own; from Nov 16, the repeat is ended: Nov 30
    // would go, its rename with it, as an end set before it would.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      await refusalOf(edit("following", nov16, { recurrence: [] }))
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-30T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
        seriesOnly: true,
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("Repeat: None from an occurrence ends the series there", async () => {
    const google = fakeGoogle(weekly);
    expect(
      Exit.isSuccess(await run(edit("following", nov16, { recurrence: [] })))
    ).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("made all day, a renamed occurrence is carried to its day", async () => {
    // Nov 30 renamed on its own; from Nov 16 made all day.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { date: "2026-11-17" },
            start: { date: "2026-11-16" },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20261130`
    );
    expect(carried?.body).toMatchObject({ summary: "Planning (renamed)" });
  });

  test("a day on across the spring clock change keeps skips and changes on their own days", async () => {
    // Daily 9:00 from Mar 1, 2027, Mar 15 deleted and Mar 17 renamed; from
    // Mar 13 moved to Mar 14 9:00, 23 elapsed hours later.
    const daily: Event = {
      ...weekly,
      end: { dateTime: "2027-03-01T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2027-03-01T09:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(daily, [
      {
        ...occurrenceOf(daily, "2027-03-15T09:00:00-04:00"),
        status: "cancelled",
      },
      {
        ...occurrenceOf(daily, "2027-03-17T09:00:00-04:00"),
        summary: "Planning (Mar 17)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(daily, "2027-03-13T09:00:00-05:00"), {
            end: { dateTime: "2027-03-14T09:30:00-04:00", timeZone: zone },
            start: { dateTime: "2027-03-14T09:00:00-04:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20270315T130000Z",
    ]);
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20270317T130000Z`
    );
  });

  test("made timed across a clock change, places skips and changes in the new zone", async () => {
    // All-day Mondays from Nov 9; Mar 22 2027 deleted and Mar 15 renamed on
    // their own. From Nov 16 made 9:00 New York: after the clock change,
    // 9:00 is 13:00 UTC.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      start: { date: "2026-11-09" },
    };
    const google = fakeGoogle(allDay, [
      { ...occurrenceOf(allDay, "2027-03-22"), status: "cancelled" },
      { ...occurrenceOf(allDay, "2027-03-15"), summary: "Planning (renamed)" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(allDay, "2026-11-16"), {
            end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20270322T130000Z",
    ]);
    expect(carried?.url.pathname).toEndWith(
      `/events/${String(created?.body?.id)}_20270315T130000Z`
    );
  });

  test.each([
    // Google's own "ends Nov 30"; moved to Tue Dec 1.
    ["20261201T045959Z", "2026-12-01T09:00:00-05:00"],
    // An end at the last meeting's start; moved to 10:00.
    ["20261130T140000Z", "2026-11-30T10:00:00-05:00"],
  ])(
    "the last meeting moved past the series' end (UNTIL=%s) is one event",
    async (until, to) => {
      const ending: Event = {
        ...weekly,
        recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${until}`],
      };
      const google = fakeGoogle(ending);
      expect(
        Exit.isSuccess(
          await run(
            edit(
              "following",
              occurrenceOf(ending, "2026-11-30T09:00:00-05:00"),
              {
                end: {
                  dateTime: to.replace(":00:00-", ":30:00-"),
                  timeZone: zone,
                },
                start: { dateTime: to, timeZone: zone },
              }
            )
          )
        )
      ).toBe(true);
      const [created, cut] = google.writes();
      expect(created?.body).toMatchObject({
        recurrence: [],
        start: { dateTime: to },
      });
      expect(cut?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T135959Z",
      ]);
    }
  );

  test("the last rule meeting moved past the end keeps a later added meeting", async () => {
    // Mondays until Nov 30 plus an added Dec 10, renamed on its own; from
    // Nov 30 moved to Tue Dec 1: the new part keeps Dec 10 and its name.
    const ending: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201T045959Z",
        "RDATE;TZID=America/New_York:20261210T090000",
      ],
    };
    const google = fakeGoogle(ending, [
      {
        ...occurrenceOf(ending, "2026-12-10T09:00:00-05:00"),
        summary: "Planning (Dec 10)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(ending, "2026-11-30T09:00:00-05:00"), {
            end: { dateTime: "2026-12-01T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-12-01T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RDATE;TZID=America/New_York:20261210T090000",
    ]);
    expect(carried?.body).toMatchObject({ summary: "Planning (Dec 10)" });
  });

  test.each([
    "RRULE:FREQ=WEEKLY;UNTIL=20261201T045959Z;BYDAY=MO",
    "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261201T045959Z",
  ])(
    "the last meeting moved past the end with its own rule rewritten (%s) is one event",
    async (rewritten) => {
      const ending: Event = {
        ...weekly,
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201T045959Z"],
      };
      const google = fakeGoogle(ending);
      expect(
        Exit.isSuccess(
          await run(
            edit(
              "following",
              occurrenceOf(ending, "2026-11-30T09:00:00-05:00"),
              {
                end: { dateTime: "2026-12-01T09:30:00-05:00", timeZone: zone },
                recurrence: [rewritten],
                start: {
                  dateTime: "2026-12-01T09:00:00-05:00",
                  timeZone: zone,
                },
              }
            )
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([]);
    }
  );

  test("a move past the series' end is refused while a later occurrence has changes", async () => {
    // Mondays until Nov 30, Nov 23 renamed on its own; from Nov 16 moved to
    // Tue Dec 1, past the end: the new part has no place for Nov 23.
    const ending: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261201T045959Z"],
    };
    const google = fakeGoogle(ending, [
      {
        ...occurrenceOf(ending, "2026-11-23T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(ending, "2026-11-16T09:00:00-05:00"), {
          end: { dateTime: "2026-12-01T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-12-01T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new time carries a deleted occurrence's skip to it", async () => {
    // Nov 30 was deleted on its own; from Nov 16 the series moves to 10:00.
    // A skip left at 9:00 would match nothing, and Nov 30 would come back.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T150000Z",
    ]);
  });

  test("a new time onto a deleted occurrence keeps the meeting just saved", async () => {
    // Hourly from 9:00, 12:00 deleted on its own; from 10:00 the series
    // moves to 12:00. The deleted 12:00 is now the new series' 14:00, and
    // its first meeting, the one just saved, isn't skipped.
    const hourly: Event = { ...weekly, recurrence: ["RRULE:FREQ=HOURLY"] };
    const google = fakeGoogle(hourly, [
      {
        ...occurrenceOf(hourly, "2026-11-09T12:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(hourly, "2026-11-09T10:00:00-05:00"), {
            end: { dateTime: "2026-11-09T12:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T12:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=HOURLY", "EXDATE:20261109T190000Z"],
      start: { dateTime: "2026-11-09T12:00:00-05:00" },
    });
  });

  test("a move of one of two weekdays keeps the other day's deleted and changed occurrences there", async () => {
    // Mondays and Wednesdays; Wed Nov 25 deleted and Wed Dec 2 renamed on
    // their own. From Nov 16 the Mondays move to Tuesdays: Wednesdays stay,
    // so do their skip and rename.
    const twoDays: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    };
    const google = fakeGoogle(twoDays, [
      {
        ...occurrenceOf(twoDays, "2026-11-25T09:00:00-05:00"),
        status: "cancelled",
      },
      {
        ...occurrenceOf(twoDays, "2026-12-02T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(twoDays, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,WE"],
              start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    const [created, renamed] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU,WE",
      "EXDATE:20261125T140000Z",
    ]);
    expect(renamed?.url.pathname).toEndWith("_20261202T140000Z");
    expect(renamed?.body?.summary).toBe("Planning (renamed)");
  });

  test("a weekday series moved a day keeps each later occurrence on its own day", async () => {
    // Mondays to Fridays; Thu Nov 26 deleted and Wed Nov 25 renamed on
    // their own. From Nov 16 the start moves to Tue Nov 17: every weekday
    // still meets, so both stay where they were.
    const weekdays: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    };
    const google = fakeGoogle(weekdays, [
      {
        ...occurrenceOf(weekdays, "2026-11-26T09:00:00-05:00"),
        status: "cancelled",
      },
      {
        ...occurrenceOf(weekdays, "2026-11-25T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(weekdays, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    const [created, renamed] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      "EXDATE:20261126T140000Z",
    ]);
    expect(renamed?.url.pathname).toEndWith("_20261125T140000Z");
  });

  test("a move onto a day whose occurrence was deleted keeps the moved meeting", async () => {
    // Weekdays at 9:00, Tue Nov 17 deleted on its own: moving Mon Nov 16
    // to Tue Nov 17 puts the meeting the user saved there, so no skip.
    const weekdays: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    };
    const google = fakeGoogle(weekdays, [
      {
        ...occurrenceOf(weekdays, "2026-11-17T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit(
            "following",
            occurrenceOf(weekdays, "2026-11-16T09:00:00-05:00"),
            {
              end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
            }
          )
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    ]);
  });

  test("a move onto a day whose occurrence was renamed is refused, naming it", async () => {
    const weekdays: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    };
    fakeGoogle(weekdays, [
      {
        ...occurrenceOf(weekdays, "2026-11-17T09:00:00-05:00"),
        summary: "Planning (Tuesday)",
      },
    ]);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(weekdays, "2026-11-16T09:00:00-05:00"), {
          end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-17T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
  });

  test("from the first occurrence, edits the series itself", async () => {
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("following", first, {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["PUT"]);
    expect(writes[0]?.url.pathname).toEndWith("/events/series");
    expect(writes[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });
});

describe("a split that fails part way leaves the old series whole", () => {
  const rename = () => edit("following", nov16, { summary: "Planning (new)" });
  const isCut = (request: Request) =>
    request.method === "PUT" && request.url.pathname.endsWith("/events/series");
  const readsSeries = (request: Request) =>
    request.method === "GET" && request.url.pathname.endsWith("/events/series");

  test("goes on when a create made it but its answer was lost", async () => {
    // The first try drops its connection after Google stored the series; the
    // retry finds the id taken.
    let created: Request["body"] = null;
    const google = fakeGoogle(weekly, [], (request) => {
      if (request.method === "POST") {
        if (!created) {
          created = request.body;
          throw new TypeError("network down");
        }
        return failure(409);
      }
      if (
        request.method === "GET" &&
        created &&
        request.url.pathname.endsWith(`/events/${String(created.id)}`)
      ) {
        return created;
      }
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).not.toContain(
      "DELETE"
    );
  });

  test("deletes the new series when it can't be created", async () => {
    const google = fakeGoogle(weekly, [], (request) =>
      request.method === "POST" ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    const [created, deleted] = google.writes();
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "DELETE",
    ]);
    expect(deleted?.url.pathname).toEndWith(`/events/${created?.body?.id}`);
  });

  test("deletes the new series when a moved occurrence can't be carried", async () => {
    const moved = occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
      end: "2026-11-30T12:30:00-05:00",
      start: "2026-11-30T12:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved], (request) =>
      request.method === "PUT" && !isCut(request) ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "DELETE",
    ]);
  });

  test("deletes the new series when it has no meeting for a changed occurrence", async () => {
    const renamed = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
      summary: "Planning (Nov 30)",
    };
    const google = fakeGoogle(weekly, [renamed], (request) =>
      request.url.pathname.endsWith("/instances") ? { items: [] } : undefined
    );
    expect(
      Exit.isFailure(
        await run(edit("following", nov16, { location: "Room 2" }))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "DELETE",
    ]);
  });

  test("deletes the new series when Google returns another occurrence for a changed one", async () => {
    // Nov 30 renamed on its own; the lookup for it on the new series
    // answers with Nov 16's.
    const renamed = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
      summary: "Planning (Nov 30)",
    };
    const google = fakeGoogle(weekly, [renamed], (request) => {
      if (request.url.pathname.endsWith("/instances")) {
        const seriesId = request.url.pathname.split("/").at(-2) ?? "";
        return {
          items: [
            occurrenceOf(
              { ...weekly, id: seriesId },
              "2026-11-16T09:00:00-05:00"
            ),
          ],
        };
      }
    });
    expect(
      Exit.isFailure(
        await run(edit("following", nov16, { location: "Room 2" }))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "DELETE",
    ]);
  });

  test("deletes the new series when the cut fails and the old one reads whole", async () => {
    const google = fakeGoogle(weekly, [], (request) =>
      isCut(request) ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "DELETE",
    ]);
  });

  test("leaves both series when every try at the cut gets a server error, even if the old one reads whole", async () => {
    // A write Google answered with a 503 may still go through; it's tried
    // three times.
    const google = fakeGoogle(weekly, [], (request) =>
      isCut(request) ? failure(503) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "PUT",
      "PUT",
    ]);
  });

  test("finishes the split when a cut Google rate-limited goes through on a retry", async () => {
    // A 429 was never applied: tried again, the cut goes through.
    let tries = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        tries += 1;
        return tries === 1 ? failure(429) : undefined;
      }
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "PUT",
    ]);
  });

  test("finishes the split when a cut Google rate-limited with a 403 goes through on a retry", async () => {
    // Google often names a rate limit in a 403 rather than send a 429.
    let tries = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        tries += 1;
        return tries === 1
          ? new Response(
              JSON.stringify({
                error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] },
              }),
              { status: 403 }
            )
          : undefined;
      }
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "PUT",
    ]);
  });

  test("finishes the split when a cut that got a server error goes through on a retry", async () => {
    let tries = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        tries += 1;
        return tries === 1 ? failure(503) : undefined;
      }
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "PUT",
    ]);
  });

  test("leaves both series when the cut gets no answer, even if the old one reads whole", async () => {
    // A cut Google never answered may still go through after the read.
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        throw new TypeError("network down");
      }
    });
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).not.toContain(
      "DELETE"
    );
  });

  test("leaves both series when a cut gets no answer, though a retry would", async () => {
    // The first try drops its connection; a retry would get a plain error.
    let tries = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        tries += 1;
        if (tries === 1) {
          throw new TypeError("network down");
        }
        return failure(403);
      }
    });
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).not.toContain(
      "DELETE"
    );
  });

  test("keeps the split when the cut's answer failed but it went through", async () => {
    let master = weekly;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        master = {
          ...weekly,
          recurrence: request.body?.recurrence as string[],
        };
        return failure(400);
      }
      return readsSeries(request) ? master : undefined;
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("leaves both series when the cut fails and the old one changed some other way", async () => {
    // Another app added Wednesdays meanwhile: which meetings the old series
    // keeps isn't known, so neither series is touched again.
    let cutTried = false;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        cutTried = true;
        return failure(400);
      }
      if (!(cutTried && readsSeries(request))) {
        return;
      }
      return { ...weekly, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"] };
    });
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("leaves both series when the cut fails and the old one can't be read", async () => {
    // Showing a meeting twice beats losing one.
    let reads = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        return failure(400);
      }
      if (readsSeries(request)) {
        reads += 1;
        return reads > 1 ? failure(404) : weekly;
      }
    });
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("a move to another calendar deletes its new series on failure too", async () => {
    const google = fakeGoogle(weekly, [nov16], (request) =>
      request.method === "POST" ? failure(403) : undefined
    );
    expect(
      Exit.isFailure(
        await run(service().moveEvent("primary", nov16.id, "work", "following"))
      )
    ).toBe(true);
    const [created, deleted] = google.writes();
    expect(created?.url.pathname).toContain("/calendars/work/");
    expect(created?.body).toMatchObject({
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
    });
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.url.pathname).toContain("/calendars/work/");
  });
});

describe("a move to another calendar from an occurrence", () => {
  test("carries a renamed occurrence on its own slot under a rule not read here", async () => {
    // A rule by days of the year (Mondays Nov 9 to Dec 7) isn't read, but
    // the moved series repeats by it from one of its own meetings, so a
    // renamed Nov 30 keeps its slot there.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;BYYEARDAY=313,320,327,334,341"],
    };
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(series, [
      opened,
      { ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"), summary: "Mine" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          service().moveEvent("primary", opened.id, "work", "following")
        )
      )
    ).toBe(true);
    expect(
      google.writes().some((write) => write.body?.summary === "Mine")
    ).toBe(true);
  });
});

describe("what Google keeps as an occurrence's own", () => {
  test("a deleted occurrence Google lists with only its ids is still read", async () => {
    const google = fakeGoogle(weekly, [
      {
        id: "series_20261130T140000Z",
        originalStartTime: {
          dateTime: "2026-11-30T09:00:00-05:00",
          timeZone: zone,
        },
        recurringEventId: "series",
        status: "cancelled",
      } as Event,
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("following", nov16, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    // Skipped at the series' own time (Google takes it in UTC).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T140000Z",
    ]);
  });

  test("a carried occurrence keeps its own meeting link", async () => {
    const meet = {
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
    };
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        conferenceData: meet,
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("following", nov16, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [, carried] = google.writes();
    expect(carried?.body?.conferenceData).toEqual(meet);
    expect(carried?.url.searchParams.get("conferenceDataVersion")).toBe("1");
    // It keeps its place in the new series.
    expect(carried?.body?.recurringEventId).toBe(google.writes()[0]?.body?.id);
  });

  test("an original start written without an offset is read in its zone", async () => {
    const opened = {
      ...nov16,
      originalStartTime: { dateTime: "2026-11-16T09:00:00", timeZone: zone },
    };
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body?.start).toEqual({
      dateTime: "2026-11-16T09:00:00-05:00",
      timeZone: zone,
    });
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
    ]);
  });
});

describe("a series save sends only what the user changed", () => {
  // As a client may save it: the opened occurrence's own times (left as
  // they were) and the one field changed, nothing else.
  const save = (
    scope: "all" | "following",
    occurrence: Event,
    changes: Partial<CreateEvent>
  ) =>
    service().updateEvent(
      "primary",
      occurrence.id,
      { end: occurrence.end, start: occurrence.start, ...changes },
      scope,
      occurrence
    );
  const moved = {
    ...occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    }),
    description: "Bring the draft",
    summary: "Planning (moved)",
  };

  test("This and following: the new series is the series', the moved one stays moved", async () => {
    const google = fakeGoogle(weekly, [moved]);
    expect(
      Exit.isSuccess(
        await run(save("following", moved, { location: "Room 2" }))
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body).toMatchObject({
      location: "Room 2",
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
    expect(created?.body).not.toHaveProperty("description");
    expect(carried?.body).toMatchObject({
      description: "Bring the draft",
      location: "Room 2",
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
      summary: "Planning (moved)",
    });
  });
});

describe("This and following keeps what a later occurrence has", () => {
  test("an empty field the form sends doesn't clear a later occurrence's own", async () => {
    // A form writes an empty description as "". Nov 30 has notes of its
    // own; renaming from Nov 16 keeps them there.
    const own = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
      description: "Bring the draft",
    };
    const google = fakeGoogle(weekly, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            description: "",
            location: "",
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.summary).toBe("Planning (new)");
    expect(carried?.body).toMatchObject({ description: "Bring the draft" });
    expect(google.writes()).toHaveLength(3);
  });

  test("a moved added meeting stays on its own slot, not the rule's", async () => {
    // Mondays 9:00 plus an added Nov 30 15:00, moved to 16:00 on its own.
    // Renamed from Nov 16, the move stays on the 15:00 meeting; Nov 30's
    // 9:00 meeting is left alone.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T150000",
      ],
    };
    const moved = occurrenceOf(series, "2026-11-30T15:00:00-05:00", {
      end: "2026-11-30T16:30:00-05:00",
      start: "2026-11-30T16:00:00-05:00",
    });
    const google = fakeGoogle(series, [moved]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual(series.recurrence);
    const lookup = google.requests.find((request) =>
      request.url.pathname.endsWith(`/events/${created?.body?.id}/instances`)
    );
    expect(lookup?.url.searchParams.get("originalStart")).toBe(
      "2026-11-30T15:00:00-05:00"
    );
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-30T16:00:00-05:00", timeZone: zone },
    });
  });
});

describe("edges a series write has to tell apart", () => {
  test("an added meeting before the series' start isn't its first meeting", async () => {
    // Mondays from Nov 9, plus added Nov 1 and Nov 5: This and following
    // from Nov 5 can't start a series there (and mustn't change Nov 1).
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-05T09:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("deleting from an added meeting before the series' start also skips that start", async () => {
    // Mondays from Nov 9, plus added Nov 1 and Nov 5: deleting from Nov 5
    // on leaves only Nov 1. The cut alone would leave Nov 9, which Google
    // keeps as the series' start whatever its rule says.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const opened = occurrenceOf(series, "2026-11-05T09:00:00-05:00");
    const google = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261105T135959Z",
        "RDATE;TZID=America/New_York:20261101T090000",
        "EXDATE:20261109T140000Z",
      ],
    ]);
  });

  test("a field cleared for the following meetings clears a later one's own too", async () => {
    // Nov 30 had its own notes; the user clears the notes from Nov 16 on.
    const noted = { ...weekly, description: "Agenda in the doc" };
    const own = {
      ...occurrenceOf(noted, "2026-11-30T09:00:00-05:00"),
      description: "Bring the draft",
    };
    const google = fakeGoogle(noted, [own]);
    const opened = occurrenceOf(noted, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(await run(edit("following", opened, { description: "" })))
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body?.description).toBe("");
    // Nothing of Nov 30's own is left to carry.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(2);
  });
});

describe("series shapes a write has to keep as they are", () => {
  test("This and following from the first meeting, also an added day, splits there", async () => {
    // Mondays from Wed Nov 4, with Nov 1 and Nov 4 itself added.
    const series = {
      ...weekly,
      end: { dateTime: "2026-11-04T09:30:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261104T090000",
      ],
      start: { dateTime: "2026-11-04T09:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-04T09:00:00-05:00"), {
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body).toMatchObject({
      start: { dateTime: "2026-11-04T09:00:00-05:00" },
      summary: "Planning (new)",
    });
    // The old series keeps Nov 1 alone.
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261104T135959Z",
      "RDATE;TZID=America/New_York:20261101T090000",
      "EXDATE:20261104T140000Z",
    ]);
  });

  test("This and following from the first meeting splits there with meetings added before it", async () => {
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-09T09:00:00-05:00"), {
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.method).toBe("POST");
    expect(created?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "Planning (new)",
    });
    // The old series keeps only the meetings added before Nov 9: its rule
    // ends before then, and Nov 9, its start, is skipped.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(cut?.body).toMatchObject({
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T135959Z",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
        "EXDATE:20261109T140000Z",
      ],
      summary: "Planning",
    });
    expect(google.writes()).toHaveLength(2);
  });

  test("Repeat: None from an occurrence with its own attachment keeps it", async () => {
    // Nov 16 has a file of its own; from it, the repeat is ended.
    const opened = {
      ...occurrenceOf(weekly, "2026-11-16T09:00:00-05:00"),
      attachments: [{ fileUrl: "https://example.com/agenda" }],
    };
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(await run(edit("following", opened, { recurrence: [] })))
    ).toBe(true);
    const [created] = google.writes();
    expect(created?.url.searchParams.get("supportsAttachments")).toBe("true");
    expect(created?.body).toMatchObject({
      attachments: [{ fileUrl: "https://example.com/agenda" }],
    });
  });

  test("Repeat: None from a moved occurrence keeps it as one event, as it was", async () => {
    // Nov 16 was moved to Tue Nov 17 11:00; from it, the repeat is ended.
    const opened = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(await run(edit("following", opened, { recurrence: [] })))
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body).toMatchObject({
      recurrence: [],
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    });
    // One event: no occurrences to look up or write.
    expect(
      google.requests.some((request) =>
        request.url.pathname.endsWith("/instances")
      )
    ).toBe(false);
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(2);
  });

  test("a carried occurrence that dropped the series' meeting link keeps it dropped", async () => {
    const meet = {
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
    };
    const series = { ...weekly, conferenceData: meet };
    const { conferenceData: _meet, ...withoutLink } = occurrenceOf(
      series,
      "2026-11-30T09:00:00-05:00"
    );
    const google = fakeGoogle(series, [withoutLink]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    // Only Nov 30 is carried: the opened Nov 16 has the series' link,
    // whatever order its fields come in.
    const [, carried] = google.writes();
    expect(google.writes()).toHaveLength(3);
    expect(carried?.url.pathname).toEndWith("_20261130T140000Z");
    expect(carried?.url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(carried?.body).not.toHaveProperty("conferenceData");
  });
});

describe("This and following, where the new series sits", () => {
  test("refuses two moved occurrences that would land on one meeting", async () => {
    // Mondays plus an added Tue Dec 1, both Nov 30 and Dec 1 moved on
    // their own. From Nov 16 the series moves to Tuesdays: Nov 30 would
    // land on Dec 1, which the added meeting (kept, with its own move)
    // holds.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T090000",
      ],
    };
    const movedTo = (original: string, start: string, end: string) =>
      occurrenceOf(series, original, { end, start });
    const google = fakeGoogle(series, [
      movedTo(
        "2026-11-30T09:00:00-05:00",
        "2026-11-30T13:00:00-05:00",
        "2026-11-30T13:30:00-05:00"
      ),
      movedTo(
        "2026-12-01T09:00:00-05:00",
        "2026-12-01T15:00:00-05:00",
        "2026-12-01T15:30:00-05:00"
      ),
    ]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const refusal = await refusalOf(
      edit("following", opened, {
        end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(refusal).toMatchObject({
      data: { reason: "dropsChangedOccurrences" },
    });
    // Its rule follows the new day: one occurrence can take that.
    expect(refusal).not.toHaveProperty("data.seriesOnly");
    expect(
      [
        ...(refusal as { data: { originalStarts: string[] } }).data
          .originalStarts,
      ].sort()
    ).toEqual(["2026-11-30T09:00:00-05:00"]);
    expect(google.writes()).toEqual([]);
  });
});

describe("the opened occurrence takes the user's change", () => {
  test("from a moved and renamed first meeting, a new title reaches it too", async () => {
    // Google keeps an occurrence's own title when its series is renamed,
    // so the first meeting (moved to Tue Nov 10 11:00, titled "Special")
    // is renamed itself; its move stays.
    const first = {
      ...occurrenceOf(weekly, "2026-11-09T09:00:00-05:00", {
        end: "2026-11-10T11:30:00-05:00",
        start: "2026-11-10T11:00:00-05:00",
      }),
      summary: "Special",
    };
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(edit("following", first, { summary: "New series" }))
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.url.pathname).toEndWith("/events/series");
    expect(series?.body).toMatchObject({
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(opened?.url.pathname).toEndWith(`/events/${first.id}`);
    expect(opened?.body).toMatchObject({
      start: { dateTime: "2026-11-10T11:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(google.writes()).toHaveLength(2);
  });
});

describe("an occurrence with only its end changed", () => {
  test("keeps its own start and end through This and following", async () => {
    // Nov 30 runs on to 10:30 (its start left at 9:00); the series moves to
    // 10:00 from Nov 16. Its times are kept as a pair, as for any moved
    // occurrence: 9:00 to 10:30.
    const longer = occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
      end: "2026-11-30T10:30:00-05:00",
      start: "2026-11-30T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [longer]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith("_20261130T150000Z");
    expect(carried?.body).toMatchObject({
      end: { dateTime: "2026-11-30T10:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
    });
  });
});

describe("This and following from the first meeting is the whole series", () => {
  const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");

  test("deleting it deletes the series", async () => {
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", first.id, "following"))
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["DELETE"]);
    expect(writes[0]?.url.pathname).toEndWith("/events/series");
  });

  test("moving it moves the series", async () => {
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(service().moveEvent("primary", first.id, "work", "following"))
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url.pathname).toEndWith("/events/series/move");
    expect(writes[0]?.url.searchParams.get("destination")).toBe("work");
  });

  test("from an added meeting before the start, with nothing earlier, it's the whole series", async () => {
    // Nov 9 plus an added Nov 2, no rule: from Nov 2 on is all of it.
    const series = {
      ...weekly,
      recurrence: ["RDATE;TZID=America/New_York:20261102T090000"],
    };
    const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
    const deleted = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(
      deleted.writes().map((write) => [write.method, write.url.pathname])
    ).toEqual([["DELETE", "/calendar/v3/calendars/primary/events/series"]]);
    // Mondays from Nov 9 with added Nov 1 and Nov 5: from Nov 1 on is all.
    const earliest = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const nov1 = occurrenceOf(earliest, "2026-11-01T09:00:00-05:00");
    const all = fakeGoogle(earliest, [nov1]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", nov1.id, "following"))
      )
    ).toBe(true);
    expect(all.writes().map((write) => write.method)).toEqual(["DELETE"]);
    const renamed = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    expect(
      renamed.writes().map((write) => [write.method, write.body?.summary])
    ).toEqual([["PUT", "Planning (new)"]]);
  });

  test.each([
    ["a new time", "2026-11-02T10:00:00-05:00", undefined],
    ["a new day", "2026-11-03T09:00:00-05:00", undefined],
    ["Repeat: None", "2026-11-02T09:00:00-05:00", []],
  ])(
    "from that added meeting, %s is still refused",
    async (_change, start, recurrence) => {
      // That meeting's own new slot or repeat, which no write of the series
      // gives it: Mondays from Nov 9 plus an added Nov 2, opened at Nov 2.
      const series = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261102T090000",
        ],
      };
      const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
      const google = fakeGoogle(series, [opened]);
      expect(
        await refusalOf(
          edit("following", opened, {
            end: {
              dateTime: start.replace(":00:00-", ":30:00-"),
              timeZone: zone,
            },
            start: { dateTime: start, timeZone: zone },
            ...(recurrence ? { recurrence } : {}),
          })
        )
      ).toMatchObject({ data: { reason: "addedOccurrence" } });
      expect(google.writes()).toEqual([]);
    }
  );

  test("from the added meeting of a series of added days only, Repeat: None is still refused", async () => {
    const series = {
      ...weekly,
      recurrence: ["RDATE;TZID=America/New_York:20261102T090000"],
    };
    const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
    const google = fakeGoogle(series, [opened]);
    expect(
      await refusalOf(edit("following", opened, { recurrence: [] }))
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("with meetings added before it, either splits there", async () => {
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261105T090000",
      ],
    };
    const opened = occurrenceOf(series, "2026-11-09T09:00:00-05:00");
    // What's left of the series: Nov 5, added before its start.
    const cutRule = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T135959Z",
      "RDATE;TZID=America/New_York:20261105T090000",
      "EXDATE:20261109T140000Z",
    ];
    const deleted = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(
      deleted.writes().map((write) => [write.method, write.body?.recurrence])
    ).toEqual([["PUT", cutRule]]);
    const moved = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          service().moveEvent("primary", opened.id, "work", "following")
        )
      )
    ).toBe(true);
    const [created, cut] = moved.writes();
    expect(created?.url.pathname).toEndWith("/calendars/work/events");
    expect(created?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
    });
    expect(cut?.body?.recurrence).toEqual(cutRule);
    expect(moved.writes()).toHaveLength(2);
  });
});

describe("a series This and following can't keep", () => {
  test("one with an exclusion rule is refused before writing", async () => {
    // Daily, skipping every other Sunday from Nov 9: a new series from
    // Nov 16 would skip other Sundays.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY",
        "EXRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "severalRules" } });
    expect(google.writes()).toEqual([]);
  });

  test("one with two counted rules is refused before anything else is read", async () => {
    // 9:00 and 15:00 daily, five each: one new series can't carry both.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
        "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-11T15:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "severalRules" } });
    expect(google.requests.map((request) => request.method)).toEqual(["GET"]);
  });
});

describe("cutting the old series", () => {
  test("ends an all-day series the day before, as a date", () => {
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-10",
        recurrence: ["EXDATE;VALUE=DATE:20261103", "RRULE:FREQ=DAILY;COUNT=10"],
        seriesStart: { date: "2026-11-01" },
        seriesZone: zone,
      })
    ).toEqual([
      "EXDATE;VALUE=DATE:20261103",
      "RRULE:FREQ=DAILY;UNTIL=20261109",
    ]);
  });

  test("ends a timed series the second before, in UTC", () => {
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-10T09:00:00-05:00",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270101T000000Z"],
        seriesStart: { dateTime: "2026-11-03T09:00:00-05:00" },
        seriesZone: zone,
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T135959Z"]);
  });

  test("cuts a rule written COUNT-first without an empty part", () => {
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-10T09:00:00-05:00",
        recurrence: ["RRULE:COUNT=5;FREQ=DAILY"],
        seriesStart: { dateTime: "2026-11-08T09:00:00-05:00" },
        seriesZone: zone,
      })
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261110T135959Z"]);
  });

  test("splits added days written as Google date-times", () => {
    const rule = [
      "RRULE:FREQ=WEEKLY",
      "RDATE:2026-11-16T14:00:00Z,2026-11-23T14:00:00Z",
    ];
    expect(
      splitAddedDays(
        rule,
        "2026-11-20T09:00:00-05:00",
        "America/New_York",
        "from"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "RDATE:2026-11-23T14:00:00Z"]);
  });

  test("gives each part its own added days", () => {
    const rule = ["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261101,20261109"];
    // The old part ends before Nov 3: Nov 9 isn't its any more.
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-03",
        recurrence: rule,
        seriesStart: { date: "2026-11-01" },
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;UNTIL=20261102",
      "RDATE;VALUE=DATE:20261101",
    ]);
    expect(
      splitAddedDays(rule, "2026-11-03", "America/New_York", "from")
    ).toEqual(["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261109"]);
  });
});

describe("This and following in a series that meets within the day", () => {
  test("puts a later occurrence back at its own hour", async () => {
    // Hourly from 9:00; 11:00 was renamed on its own. A location-only
    // save from 10:00 carries it to the new series' 11:00.
    const hourly: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=HOURLY"],
    };
    const opened = occurrenceOf(hourly, "2026-11-09T10:00:00-05:00");
    const renamed = {
      ...occurrenceOf(hourly, "2026-11-09T11:00:00-05:00"),
      summary: "Planning (11:00)",
    };
    const google = fakeGoogle(hourly, [opened, renamed]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { location: "Room 1" }))
      )
    ).toBe(true);
    const carried = google
      .writes()
      .find((write) => write.body?.summary === "Planning (11:00)");
    expect(carried?.url.pathname).toEndWith("_20261109T160000Z");
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-09T11:00:00-05:00" },
    });
  });
});
