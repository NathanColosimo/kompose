import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
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
  // A calendar move takes the whole series, which a new day can't move.
  expect(off({ calendarChanged: true, dateMoved: true })).toEqual([
    "all",
    "following",
    "this",
  ]);
  expect(off({ patternChanged: true })).toEqual(["this"]);
  expect(off({ dateMoved: true })).toEqual(["all"]);
  // "This and following" carries the rule to the new day: it waits for it.
  expect(off({ dateMoved: true, seriesRuleLoaded: false })).toEqual([
    "all",
    "following",
  ]);
});

/** Every combination of the given values, one per key. */
function combinations<T extends Record<string, readonly unknown[]>>(
  values: T
): { [K in keyof T]: T[K][number] }[] {
  // Built key by key, which the mapped type can't follow: cast once.
  return Object.entries(values).reduce<Record<string, unknown>[]>(
    (sets, [key, options]) =>
      sets.flatMap((set) =>
        options.map((option) => ({ ...set, [key]: option }))
      ),
    [{}]
  ) as { [K in keyof T]: T[K][number] }[];
}

test("says why whenever a scope is off", () => {
  const plain = SCOPE_DIALOG_COPY.saveEvent.description;
  const flags = [false, true] as const;
  const all = combinations({
    calendarChanged: flags,
    dateMoved: flags,
    droppedChangedDay: [null, Temporal.PlainDate.from("2026-12-07")],
    patternChanged: flags,
    repeatSkips: [null, "day", "end"],
    retimed: flags,
    seriesRuleFailed: flags,
    seriesRuleLoaded: flags,
    severalRules: flags,
    splitBlocked: [null, "addedOccurrence", "severalRules"],
  } as const);
  for (const changes of all) {
    const anyOff = Object.keys(eventSaveDisabledScopes(changes)).length > 0;
    expect(eventSaveDescription(changes) === plain).toBe(!anyOff);
  }
});

test("leaves no scope only for a save that needs two, or one waiting on the series", () => {
  const noneLeft = (changes: Partial<EventSaveChanges>) =>
    off(changes).length === RECURRENCE_SCOPE_OPTIONS.length;
  // A calendar move with a new day, or a new repeat that skips this one.
  expect(noneLeft({ calendarChanged: true, dateMoved: true })).toBe(true);
  expect(
    noneLeft({
      calendarChanged: true,
      patternChanged: true,
      repeatSkips: "day",
    })
  ).toBe(true);
  // A new repeat waits for the series to say whether it skips this one.
  expect(noneLeft({ patternChanged: true, seriesRuleLoaded: false })).toBe(
    true
  );
  // A calendar move whose new repeat drops a moved meeting, or whose new
  // time can't apply to a series of several rules.
  expect(
    noneLeft({
      calendarChanged: true,
      droppedChangedDay: Temporal.PlainDate.from("2026-12-07"),
      patternChanged: true,
    })
  ).toBe(true);
  expect(
    noneLeft({ calendarChanged: true, retimed: true, severalRules: true })
  ).toBe(true);
  // Everything else leaves at least one.
  expect(noneLeft({ dateMoved: true, patternChanged: true })).toBe(false);
  expect(noneLeft({ dateMoved: true, seriesRuleLoaded: false })).toBe(false);
  expect(noneLeft({ calendarChanged: true, patternChanged: true })).toBe(false);
});

test("says why the scopes are what they are", () => {
  expect(eventSaveDescription({ ...none, dateMoved: true })).toBe(
    "This occurrence is now on another day than its series, so your changes apply to it, or from it on."
  );
  expect(
    eventSaveDescription({ ...none, dateMoved: true, seriesRuleLoaded: false })
  ).toBe(
    "This occurrence is now on another day than its series, so your changes apply to it, or from it on. Loading the series… This and following opens once it's in."
  );
  // A new repeat on a new day can only go from here on.
  expect(
    eventSaveDescription({ ...none, dateMoved: true, patternChanged: true })
  ).toBe(
    "This occurrence is now on another day than its series, so a new repeat applies from it on."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      patternChanged: true,
      seriesTimeZone: "Asia/Tokyo",
    })
  ).toBe(
    "In Tokyo time, this occurrence is now on another day than its series, so a new repeat applies from it on."
  );
  // A new repeat alone: never one occurrence's.
  expect(eventSaveDescription({ ...none, patternChanged: true })).toBe(
    "A new repeat applies from this occurrence on, or to the entire series."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesRuleFailed: true,
      seriesRuleLoaded: false,
    })
  ).toBe(
    "Couldn't load the series, so your changes apply to this occurrence only. Try again later for the rest."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Asia/Tokyo",
    })
  ).toBe(
    "In Tokyo time, this occurrence is now on another day than its series, so your changes apply to it, or from it on."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Etc/GMT-9",
    })
  ).toBe(
    "This occurrence is now on another day than its series, so your changes apply to it, or from it on."
  );
  expect(eventSaveDescription({ ...none, calendarChanged: true })).toBe(
    "Moving to another calendar moves the whole series."
  );
  expect(
    eventSaveDescription({ ...none, calendarChanged: true, dateMoved: true })
  ).toBe(
    "Moving to another calendar moves the whole series, but this occurrence is now on another day than its series, which can't go with it. Move the calendar and change the times in two saves."
  );
  expect(
    eventSaveDescription({
      ...none,
      calendarChanged: true,
      patternChanged: true,
      seriesRuleLoaded: false,
    })
  ).toBe(
    "Moving to another calendar moves the whole series. Loading the series… A new repeat can be saved once it's in."
  );
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
    "This occurrence is now on another day than its series, so your changes apply to it, or from it on. This occurrence was added to the series on its own, so This and following isn't available."
  );
  // A new repeat can then only go to the entire series.
  expect(eventSaveDescription({ ...blocked, patternChanged: true })).toBe(
    "This occurrence was added to the series on its own, so This and following isn't available. A new repeat applies to the entire series."
  );
  // A new day and a new repeat at once: no scope fits, and it says so,
  // with the reason that applies.
  const stuck = { ...blocked, dateMoved: true, patternChanged: true };
  expect(off(stuck)).toEqual(["all", "following", "this"]);
  expect(eventSaveDescription(stuck)).toBe(
    "This occurrence was added to the series on its own, so This and following isn't available. Change the times and the repeat in two saves."
  );
  expect(eventSaveDescription({ ...stuck, splitBlocked: "severalRules" })).toBe(
    "This series repeats by more than one rule, so This and following isn't available. Change the times and the repeat in two saves."
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
  // following can start here, and whether Entire series would skip this
  // occurrence.
  const repeat = { ...loading, patternChanged: true };
  expect(off(repeat)).toEqual(["all", "following", "this"]);
  expect(eventSaveDescription(repeat)).toBe(
    "Loading the series… A new repeat can be saved once it's in."
  );
  expect(eventSaveDescription({ ...repeat, seriesRuleFailed: true })).toBe(
    "Couldn't load the series, so a new repeat can't be saved. Try again later."
  );
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
  // A moved day prefers This and following; while the series loads, only
  // "Only this occurrence" is on, so it shows that, and returns to This and
  // following once the series is in, unless the user picked one.
  const loading = { all: true, following: true };
  const loaded = { all: true };
  expect(chosenScope(null, "following", loading)).toBe("this");
  expect(chosenScope(null, "following", loaded)).toBe("following");
  expect(chosenScope("this", "following", loaded)).toBe("this");
  // A pick that turns off falls back to the narrowest available.
  expect(chosenScope("following", "following", loading)).toBe("this");
});

describe("a new repeat on an occurrence off its series' day", () => {
  const changes = {
    calendarChanged: false,
    dateMoved: false,
    repeatSkips: "day" as const,
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

test("a new repeat from an added occurrence that it would skip says where to change it", () => {
  const changes = {
    calendarChanged: false,
    dateMoved: false,
    repeatSkips: "day" as const,
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
    "This occurrence was added to the series on its own, so This and following isn't available. Counted from the series' first meeting, the new repeat would skip this occurrence, so change the repeat from that first meeting."
  );
  expect(
    eventSaveDescription({
      ...changes,
      repeatSkips: "end",
      splitBlocked: "severalRules",
    })
  ).toBe(
    "This series repeats by more than one rule, so This and following isn't available. Counted from the series' first meeting, the new end comes before this occurrence, so change the repeat from that first meeting."
  );
});

test("a calendar move with a new repeat that would skip this occurrence can't be saved", () => {
  const changes = {
    calendarChanged: true,
    dateMoved: false,
    repeatSkips: "day" as const,
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
  expect(eventSaveDescription({ ...changes, repeatSkips: "end" })).toBe(
    SCOPE_DIALOG_COPY.moveEventRepeatEnd
  );
  // With the repeat's day picked (not off its day), the move goes ahead.
  expect(eventSaveDisabledScopes({ ...changes, repeatSkips: null })).toEqual({
    following: true,
    this: true,
  });
});

test("a new end before this occurrence says so", () => {
  expect(
    eventSaveDescription({
      calendarChanged: false,
      dateMoved: false,
      patternChanged: true,
      repeatSkips: "end",
      seriesRuleLoaded: true,
    })
  ).toBe(SCOPE_DIALOG_COPY.repeatEndOff);
});

describe("a save that would undo a meeting's own changes", () => {
  const dec7 = Temporal.PlainDate.from("2026-12-07");
  const changes = { ...none, droppedChangedDay: dec7, patternChanged: true };

  test("turns Entire series off and names the meeting", () => {
    expect(off(changes)).toEqual(["all", "this"]);
    expect(eventSaveDescription(changes)).toBe(
      "The new repeat would undo your changes to the Dec 7 meeting, so it can't apply to the entire series."
    );
  });

  test("a new time does it too", () => {
    const retimed = { ...none, droppedChangedDay: dec7, retimed: true };
    expect(off(retimed)).toEqual(["all"]);
    expect(eventSaveDescription(retimed)).toBe(
      "The new time would undo your changes to the Dec 7 meeting, so it can't apply to the entire series."
    );
  });

  test("says it after why This and following is off too", () => {
    const blocked = { ...changes, splitBlocked: "addedOccurrence" as const };
    expect(off(blocked)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(blocked)).toBe(
      "This occurrence was added to the series on its own, so This and following isn't available. The new repeat would undo your changes to the Dec 7 meeting, so it can't apply to the entire series."
    );
  });

  test("holds a calendar move, which takes the whole series", () => {
    const move = { ...changes, calendarChanged: true };
    expect(off(move)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(move)).toBe(
      "Moving to another calendar moves the whole series, but the new repeat would undo your changes to the Dec 7 meeting. Move the calendar and change the repeat in two saves."
    );
  });

  test("a repeat that skips this occurrence itself says that first", () => {
    expect(eventSaveDescription({ ...changes, repeatSkips: "day" })).toBe(
      SCOPE_DIALOG_COPY.repeatOffDay
    );
  });

  test("a series of several rules says why a new time can't go first", () => {
    const several = {
      ...none,
      droppedChangedDay: dec7,
      retimed: true,
      severalRules: true,
    };
    expect(eventSaveDescription(several)).toBe(
      SCOPE_DIALOG_COPY.severalRulesTime
    );
  });

  test("doesn't matter without a new repeat or time", () => {
    expect(off({ ...changes, patternChanged: false })).toEqual([]);
  });

  test("still reads the field it replaces, droppedMovedDay", () => {
    expect(
      off({ ...none, droppedMovedDay: dec7, patternChanged: true })
    ).toEqual(["all", "this"]);
  });
});

describe("a new time for a series of several rules", () => {
  const changes = { ...none, retimed: true, severalRules: true };

  test("applies to this occurrence only, and says why", () => {
    const occurrence = { ...changes, splitBlocked: "severalRules" as const };
    expect(off(occurrence)).toEqual(["all", "following"]);
    expect(eventSaveDescription(occurrence)).toBe(
      "This series repeats by more than one rule, so This and following isn't available. A new time applies to this occurrence only."
    );
    // Opened from the series itself (no occurrence to split at).
    expect(off(changes)).toEqual(["all"]);
    expect(eventSaveDescription(changes)).toBe(
      "This series repeats by more than one rule, so a new time can't apply to the entire series."
    );
  });

  test("with a new repeat too, needs two saves", () => {
    const both = {
      ...changes,
      patternChanged: true,
      splitBlocked: "severalRules" as const,
    };
    expect(off(both)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(both)).toBe(
      "This series repeats by more than one rule, so This and following isn't available. Change the times and the repeat in two saves."
    );
  });

  test("holds a calendar move", () => {
    expect(eventSaveDescription({ ...changes, calendarChanged: true })).toBe(
      SCOPE_DIALOG_COPY.moveEventSeveralRulesTime
    );
  });

  test("a calendar move waits for the series too, and says only Entire series opens", () => {
    const move = {
      ...none,
      calendarChanged: true,
      retimed: true,
      seriesRuleLoaded: false,
    };
    expect(off(move)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(move)).toBe(
      "Moving to another calendar moves the whole series. Loading the series… Entire series opens once it's in."
    );
    expect(eventSaveDescription({ ...move, seriesRuleFailed: true })).toBe(
      "Moving to another calendar moves the whole series. Couldn't load the series, so the move and the new time can't be saved together. Try again later."
    );
  });

  test("a series of one rule takes a new time in full", () => {
    expect(off({ ...changes, severalRules: false })).toEqual([]);
  });

  test("waits for the series, which says how many rules it has", () => {
    const loading = { ...none, retimed: true, seriesRuleLoaded: false };
    expect(off(loading)).toEqual(["all", "following"]);
    expect(eventSaveDescription(loading)).toBe(
      "Loading the series… This and following and Entire series open once it's in."
    );
    expect(eventSaveDescription({ ...loading, seriesRuleFailed: true })).toBe(
      "Couldn't load the series, so the new time applies to this occurrence only. Try again later for the rest."
    );
  });
});
