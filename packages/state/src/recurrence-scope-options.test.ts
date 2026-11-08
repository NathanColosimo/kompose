import { describe, expect, test } from "bun:test";
import {
  allowedEventSaveScope,
  chosenScope,
  type EventSaveChanges,
  eventDeleteScopeState,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
  SCOPE_DIALOG_COPY,
  seriesCutUnsure,
  seriesSplitBlock,
} from "./recurrence-scope-options";

const none: EventSaveChanges = {
  calendarChanged: false,
  dateMoved: false,
  patternChanged: false,
  seriesRuleLoaded: true,
};

const off = (changes: Partial<EventSaveChanges>) =>
  Object.keys(eventSaveDisabledScopes({ ...none, ...changes })).sort();

test("disables the scopes a save can't use", () => {
  expect(off({})).toEqual([]);
  expect(off({ calendarChanged: true })).toEqual(["following", "this"]);
  expect(off({ patternChanged: true })).toEqual(["this"]);
  expect(off({ dateMoved: true })).toEqual(["all"]);
  // "This and following" carries the rule to the new day: it waits for it.
  expect(off({ dateMoved: true, seriesRuleLoaded: false })).toEqual([
    "all",
    "following",
  ]);
});

test("always leaves a scope to save with", () => {
  for (const calendarChanged of [false, true]) {
    for (const dateMoved of [false, true]) {
      for (const patternChanged of [false, true]) {
        for (const seriesRuleLoaded of [false, true]) {
          const disabled = eventSaveDisabledScopes({
            calendarChanged,
            dateMoved,
            patternChanged,
            seriesRuleLoaded,
          });
          const scope = allowedEventSaveScope("this", disabled);
          expect(disabled[scope]).toBeFalsy();
          expect(
            RECURRENCE_SCOPE_OPTIONS.some((option) => !disabled[option.value])
          ).toBe(true);
        }
      }
    }
  }
});

test("says why the scopes are what they are", () => {
  expect(eventSaveDescription({ ...none, dateMoved: true })).toBe(
    "A new day applies to this occurrence, or from it on."
  );
  expect(
    eventSaveDescription({ ...none, dateMoved: true, seriesRuleLoaded: false })
  ).toBe("Loading the series… This and following opens once it's in.");
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesRuleFailed: true,
      seriesRuleLoaded: false,
    })
  ).toBe(
    "Couldn't load the series, so the new day applies to this occurrence only. Try again later for the rest."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Asia/Tokyo",
    })
  ).toBe("A new day in Tokyo time applies to this occurrence, or from it on.");
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Etc/GMT-9",
    })
  ).toBe("A new day applies to this occurrence, or from it on.");
  expect(
    eventSaveDescription({ ...none, calendarChanged: true, dateMoved: true })
  ).toBe("Moving to another calendar moves the whole series.");
});

test("turns This and following off where a new series can't start", () => {
  const zone = "America/New_York";
  const master = {
    recurrence: [
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4",
      "RDATE;TZID=America/New_York:20261116T090000",
    ],
    start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
  };
  const occurrence = (dateTime: string) => ({
    originalStartTime: { dateTime, timeZone: zone },
    recurringEventId: "series",
    start: { dateTime, timeZone: zone },
  });
  // The off-week Monday was added on its own: a new series from it would
  // move every later meeting a week.
  expect(
    seriesSplitBlock(occurrence("2026-11-16T09:00:00-05:00"), master, zone)
  ).toBe("addedOccurrence");
  // The rule's own Nov 23 can start one.
  expect(
    seriesSplitBlock(occurrence("2026-11-23T09:00:00-05:00"), master, zone)
  ).toBeNull();
  // Several rules (every 2 days, and Tuesdays): never.
  expect(
    seriesSplitBlock(
      occurrence("2026-11-10T09:00:00-05:00"),
      {
        ...master,
        recurrence: [
          "RRULE:FREQ=DAILY;INTERVAL=2",
          "RRULE:FREQ=WEEKLY;BYDAY=TU",
        ],
      },
      zone
    )
  ).toBe("severalRules");
  // The scope dialog then offers the rest, and says why.
  const blocked = { ...none, splitBlocked: "addedOccurrence" as const };
  expect(off(blocked)).toEqual(["following"]);
  expect(eventSaveDescription(blocked)).toBe(
    "This occurrence was added to the series on its own, so This and following isn't available."
  );
  expect(off({ ...blocked, dateMoved: true })).toEqual(["all", "following"]);
  // A moved day keeps its own sentence, with the reason after it.
  expect(eventSaveDescription({ ...blocked, dateMoved: true })).toBe(
    "A new day applies to this occurrence, or from it on. This occurrence was added to the series on its own, so This and following isn't available."
  );
  // A new day and a new repeat at once: no scope fits, and it says so.
  const stuck = { ...blocked, dateMoved: true, patternChanged: true };
  expect(off(stuck)).toEqual(["all", "following", "this"]);
  expect(eventSaveDescription(stuck)).toBe(
    "An added occurrence can't move to another day and change its repeat in one save. Change one, then the other."
  );
});

test("keeps This and following off until the series loads", () => {
  const loading = { ...none, seriesRuleLoaded: false };
  expect(off(loading)).toEqual(["following"]);
  expect(eventSaveDescription(loading)).toBe(
    "Loading the series… This and following opens once it's in."
  );
  expect(eventSaveDescription({ ...loading, seriesRuleFailed: true })).toBe(
    "Couldn't load the series, so This and following isn't available. Try again later."
  );
  // A repeat the user set waits too: the series says whether This and
  // following can start here.
  expect(off({ ...loading, patternChanged: true })).toEqual([
    "following",
    "this",
  ]);
});

test("turns deleting This and following off where the cut is unsure", () => {
  const zone = "America/New_York";
  const occurrence = {
    originalStartTime: {
      dateTime: "2026-11-10T09:00:00-05:00",
      timeZone: zone,
    },
    recurringEventId: "series",
    start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
  };
  const master = (rule: string) => ({
    recurrence: [rule, "RDATE;TZID=America/New_York:20261110T090000"],
    start: { dateTime: "2026-11-02T09:00:00-05:00", timeZone: zone },
  });
  // On the hour and half hour, ten times: where it ends can't be told.
  expect(
    seriesCutUnsure(
      occurrence,
      master("RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10"),
      zone
    )
  ).toBe(true);
  // A daily rule's end is known: the delete can cut it there.
  expect(
    seriesCutUnsure(occurrence, master("RRULE:FREQ=DAILY;COUNT=3"), zone)
  ).toBe(false);
  // Before the series loads, nothing is turned off.
  expect(seriesCutUnsure(occurrence, null, zone)).toBe(false);
});

test("keeps deleting This and following off until the series is known", () => {
  const known = { cutUnsure: false, seriesRuleLoaded: true };
  expect(eventDeleteScopeState(known)).toEqual({
    description: "Delete:",
    disabled: {},
  });
  expect(eventDeleteScopeState({ ...known, seriesRuleLoaded: false })).toEqual({
    description: "Loading the series… This and following opens once it's in.",
    disabled: { following: true },
  });
  expect(
    eventDeleteScopeState({
      ...known,
      seriesRuleFailed: true,
      seriesRuleLoaded: false,
    }).disabled
  ).toEqual({ following: true });
  expect(eventDeleteScopeState({ ...known, cutUnsure: true })).toEqual({
    description:
      "This occurrence was added to the series on its own, and Kompose can't tell where the series' repeat ends, so This and following isn't available.",
    disabled: { following: true },
  });
});

test("returns to the preferred scope once it's available", () => {
  // A new repeat prefers This and following; while the series loads, only
  // Entire series is on, so it shows that, and returns to This and
  // following once the series is in, unless the user picked one.
  const loading = { following: true, this: true };
  const loaded = { this: true };
  expect(chosenScope(null, "following", loading)).toBe("all");
  expect(chosenScope(null, "following", loaded)).toBe("following");
  expect(chosenScope("all", "following", loaded)).toBe("all");
  // A pick that turns off falls back to the nearest available.
  expect(chosenScope("following", "following", loading)).toBe("all");
});

describe("a new repeat on an occurrence off its series' day", () => {
  const changes = {
    calendarChanged: false,
    dateMoved: false,
    offSeriesDay: true,
    patternChanged: true,
    seriesRuleLoaded: true,
  };

  test("All events is off: the series would keep its own day", () => {
    expect(eventSaveDisabledScopes(changes)).toEqual({ all: true, this: true });
  });

  test("the dialog says why", () => {
    expect(eventSaveDescription(changes)).toBe(SCOPE_DIALOG_COPY.repeatOffDay);
  });

  test("off its day but the repeat unchanged: All events stays", () => {
    expect(
      eventSaveDisabledScopes({ ...changes, patternChanged: false })
    ).toEqual({});
  });
});

test("a new repeat from an added occurrence that takes its day there says to pick the day", () => {
  const changes = {
    calendarChanged: false,
    dateMoved: false,
    offSeriesDay: true,
    patternChanged: true,
    seriesRuleLoaded: true,
    splitBlocked: "addedOccurrence" as const,
  };
  expect(eventSaveDisabledScopes(changes)).toEqual({
    all: true,
    following: true,
    this: true,
  });
  expect(eventSaveDescription(changes)).toBe(
    SCOPE_DIALOG_COPY.repeatOffDayAdded
  );
});

test("a calendar move with a new repeat that takes this occurrence's day can't be saved", () => {
  const changes = {
    calendarChanged: true,
    dateMoved: false,
    offSeriesDay: true,
    patternChanged: true,
    seriesRuleLoaded: true,
  };
  expect(eventSaveDisabledScopes(changes)).toEqual({
    all: true,
    following: true,
    this: true,
  });
  expect(eventSaveDescription(changes)).toBe(
    SCOPE_DIALOG_COPY.moveEventRepeatDay
  );
  // With the repeat's day picked (not off its day), the move goes ahead.
  expect(eventSaveDisabledScopes({ ...changes, offSeriesDay: false })).toEqual({
    following: true,
    this: true,
  });
});
