import { describe, expect, test } from "bun:test";
import { refusalMessage } from "@kompose/google-cal/series-edits";
import { ORPCError } from "@orpc/client";
import { Temporal } from "temporal-polyfill";
import {
  chosenScope,
  type EventSaveChanges,
  eventDeleteScopeState,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
  refuseSave,
  SCOPE_DIALOG_COPY,
  seriesCutUnsure,
  seriesMeetsSeveralTimesADay,
  seriesRefusalOf,
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
    opensSeries: flags,
    entireSeriesCost: [
      null,
      ...(["lostSlot", "newStart", "ownLength"] as const).map((reason) => ({
        day: Temporal.PlainDate.from("2026-12-07"),
        reason,
      })),
    ],
    patternChanged: flags,
    repeatSkips: [null, "day", "end"],
    retimed: flags,
    seriesRuleFailed: flags,
    seriesRuleLoaded: flags,
    severalRules: flags,
    movesSeveralADay: [undefined, false, true],
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
      entireSeriesCost: {
        day: Temporal.PlainDate.from("2026-12-07"),
        reason: "lostSlot",
      } as const,
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
    "This and following isn't available for an occurrence added to the series on its own."
  );
  expect(off({ ...blocked, dateMoved: true })).toEqual(["all", "following"]);
  // A moved day keeps its own sentence, with the reason after it.
  expect(eventSaveDescription({ ...blocked, dateMoved: true })).toBe(
    "This occurrence is now on another day than its series, so your changes apply to it alone. This and following isn't available for an occurrence added to the series on its own."
  );
  // A new repeat can then only go to the entire series.
  expect(eventSaveDescription({ ...blocked, patternChanged: true })).toBe(
    "This and following isn't available for an occurrence added to the series on its own. A new repeat applies to the entire series."
  );
  // A new day and a new repeat at once: no scope fits, and it says so,
  // with the reason that applies.
  const stuck = { ...blocked, dateMoved: true, patternChanged: true };
  expect(off(stuck)).toEqual(["all", "following", "this"]);
  expect(eventSaveDescription(stuck)).toBe(
    "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. This and following isn't available for an occurrence added to the series on its own. Change the times and the repeat in two saves."
  );
  expect(eventSaveDescription({ ...stuck, splitBlocked: "severalRules" })).toBe(
    "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. This and following isn't available for a series with more than one rule. Change the times and the repeat in two saves."
  );
  // A meeting the repeat would undo, behind the new day: the new times
  // go first, and the next save's dialog names the meeting.
  expect(
    eventSaveDescription({
      ...stuck,
      entireSeriesCost: {
        day: Temporal.PlainDate.from("2026-12-07"),
        reason: "lostSlot",
      },
    })
  ).toBe(
    "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. This and following isn't available for an occurrence added to the series on its own. Save the new times on their own first."
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
    "This and following isn't available for an occurrence added to the series on its own. Counted from the series' first meeting, the new repeat would skip this occurrence, so change the repeat from that first meeting."
  );
  expect(
    eventSaveDescription({
      ...changes,
      repeatSkips: "end",
      splitBlocked: "severalRules",
    })
  ).toBe(
    "This and following isn't available for a series with more than one rule. Counted from the series' first meeting, the new end comes before this occurrence, so change the repeat from that first meeting."
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

describe("an Entire series save that would cost a meeting its own changes", () => {
  const dec7 = Temporal.PlainDate.from("2026-12-07");
  const lostSlot = { day: dec7, reason: "lostSlot" } as const;
  const changes = { ...none, entireSeriesCost: lostSlot, patternChanged: true };

  test("turns Entire series off and names the meeting", () => {
    expect(off(changes)).toEqual(["all", "this"]);
    expect(eventSaveDescription(changes)).toBe(
      "The new repeat would undo your changes to the Dec 7 meeting, so it can't apply to the entire series. A new repeat applies from this occurrence on."
    );
  });

  test("a new start resets it", () => {
    const retimed = {
      ...none,
      entireSeriesCost: { day: dec7, reason: "newStart" } as const,
      retimed: true,
    };
    expect(off(retimed)).toEqual(["all"]);
    expect(eventSaveDescription(retimed)).toBe(
      "Changing the time for the entire series would reset your changed Dec 7 meeting."
    );
    expect(eventSaveDescription({ ...retimed, calendarChanged: true })).toBe(
      "Moving to another calendar moves the whole series, but changing its time would reset your changed Dec 7 meeting. Move the calendar and change the time in two saves."
    );
  });

  test("a new length would take its own", () => {
    const longer = {
      ...none,
      entireSeriesCost: { day: dec7, reason: "ownLength" } as const,
    };
    expect(off(longer)).toEqual(["all"]);
    expect(eventSaveDescription(longer)).toBe(
      "Changing the length for the entire series would also change the length you gave the Dec 7 meeting."
    );
  });

  test("says it after why This and following is off too", () => {
    const blocked = { ...changes, splitBlocked: "addedOccurrence" as const };
    expect(off(blocked)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(blocked)).toBe(
      "This and following isn't available for an occurrence added to the series on its own. The new repeat would undo your changes to the Dec 7 meeting, so it can't apply to the entire series."
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

  test("a series meeting several times a day says why a new time can't go first", () => {
    const several = {
      ...none,
      entireSeriesCost: { day: dec7, reason: "newStart" } as const,
      retimed: true,
      severalRules: true,
    };
    expect(eventSaveDescription(several)).toBe(
      SCOPE_DIALOG_COPY.severalRulesTime
    );
  });

  test("from the series' first meeting, This and following is it too", () => {
    // The server saves This and following from there as the whole series,
    // and refuses it for the same reasons.
    const first = {
      ...none,
      entireSeriesCost: { day: dec7, reason: "newStart" } as const,
      opensSeries: true,
      retimed: true,
    };
    expect(off(first)).toEqual(["all", "following"]);
    expect(eventSaveDescription(first)).toBe(
      "Changing the time for the entire series would reset your changed Dec 7 meeting. From its first meeting, This and following is the entire series too."
    );
    // With a new repeat too, nothing is on: the time and the repeat take
    // two saves. Not so for a repeat that itself undoes the meeting.
    const firstRepeat = { ...first, patternChanged: true };
    expect(off(firstRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(firstRepeat)).toBe(
      "Changing the time for the entire series would reset your changed Dec 7 meeting. Save the new times on their own first. From its first meeting, This and following is the entire series too."
    );
    expect(
      eventSaveDescription({
        ...firstRepeat,
        entireSeriesCost: { day: dec7, reason: "lostSlot" },
        retimed: false,
      })
    ).toBe(
      "The new repeat would undo your changes to the Dec 7 meeting, so it can't apply to the entire series. From its first meeting, This and following is the entire series too."
    );
    // This and following blocked, with a new time and repeat: the time
    // goes alone first.
    expect(
      eventSaveDescription({
        ...firstRepeat,
        opensSeries: false,
        splitBlocked: "addedOccurrence",
      })
    ).toBe(
      "This and following isn't available for an occurrence added to the series on its own. Changing the time for the entire series would reset your changed Dec 7 meeting. Save the new times on their own first."
    );
    // Without a new repeat, Only this takes it: no step to add.
    expect(
      eventSaveDescription({
        ...first,
        opensSeries: false,
        splitBlocked: "addedOccurrence",
      })
    ).toBe(
      "This and following isn't available for an occurrence added to the series on its own. Changing the time for the entire series would reset your changed Dec 7 meeting."
    );
    // A series meeting several times a day, given a new time there.
    const several = {
      ...none,
      opensSeries: true,
      retimed: true,
      severalRules: true,
    };
    expect(off(several)).toEqual(["all", "following"]);
    // With a new repeat too, nothing is on: the times and the repeat take
    // two saves.
    const severalRepeat = { ...several, patternChanged: true };
    expect(off(severalRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(severalRepeat)).toBe(
      "This series' meetings keep times of their own, so a new time can't apply to the entire series, nor a new repeat to one occurrence. Change the times and the repeat in two saves. From its first meeting, This and following is the entire series too."
    );
    // A new day for the first meeting moves the whole series: only Entire
    // series' own rule keeps it off.
    expect(off({ ...none, dateMoved: true, opensSeries: true })).toEqual([
      "all",
    ]);
    // Unless a meeting has changes of its own, which the new start resets.
    const newDay = { ...first, dateMoved: true };
    expect(off(newDay)).toEqual(["all", "following"]);
    expect(eventSaveDescription(newDay)).toBe(
      "This occurrence is now on another day than its series, so your changes apply to it alone. Moving the series to this day would reset your changed Dec 7 meeting. From its first meeting, This and following is the entire series too."
    );
    // With a new repeat too, which one occurrence can't take: nothing is on.
    const newDayRepeat = { ...newDay, patternChanged: true };
    expect(off(newDayRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(newDayRepeat)).toBe(
      "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. Moving the series to this day would reset your changed Dec 7 meeting. Save the new times on their own first. From its first meeting, This and following is the entire series too."
    );
  });

  test("from the series' first meeting, a new day and time for a series meeting several times a day", () => {
    const twice = {
      ...none,
      dateMoved: true,
      opensSeries: true,
      retimed: true,
      severalRules: true,
    };
    // The server saves This and following there as the whole series, and
    // refuses its new time of day.
    const newTime = { ...twice, movesSeveralADay: true };
    expect(off(newTime)).toEqual(["all", "following"]);
    expect(eventSaveDescription(newTime)).toBe(
      `This occurrence is now on another day than its series, so your changes apply to it alone. ${SCOPE_DIALOG_COPY.severalRulesTime} From its first meeting, This and following is the entire series too.`
    );
    // With a new repeat too, nothing is on: the times and the repeat take
    // two saves.
    const andRepeat = { ...newTime, patternChanged: true };
    expect(off(andRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(andRepeat)).toBe(
      "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. This series' meetings keep times of their own, so a new time can't apply to the entire series. Change the times and the repeat in two saves. From its first meeting, This and following is the entire series too."
    );
    // A meeting changed on its own: the repeat alone may cost it too, so
    // the times go first, with or without a new day.
    const changed = {
      ...andRepeat,
      entireSeriesCost: { day: dec7, reason: "newStart" } as const,
    };
    expect(eventSaveDescription(changed)).toBe(
      "This occurrence is now on another day than its series, and a new repeat can't apply to it alone. This series' meetings keep times of their own, so a new time can't apply to the entire series. Save the new times on their own first. From its first meeting, This and following is the entire series too."
    );
    expect(eventSaveDescription({ ...changed, dateMoved: false })).toBe(
      "This series' meetings keep times of their own, so a new time can't apply to the entire series, nor a new repeat to one occurrence. Save the new times on their own first. From its first meeting, This and following is the entire series too."
    );
    // A new day alone keeps every meeting's time: only Entire series is off.
    expect(off({ ...twice, movesSeveralADay: false })).toEqual(["all"]);
  });

  test("a series meeting several times a day takes a new form or length, not a new time", () => {
    const several = { ...none, retimed: true, severalRules: true };
    // All day, or a new length: the server keeps every meeting's time.
    expect(off({ ...several, movesSeveralADay: false })).toEqual([]);
    expect(off({ ...several, movesSeveralADay: true })).toEqual(["all"]);
    // Callers that don't say yet: any new start is taken as a new time.
    expect(off(several)).toEqual(["all"]);
  });

  test("with a new repeat, says it goes from this occurrence on", () => {
    // A later occurrence: This and following is the one scope left.
    const repeat = { ...none, patternChanged: true, retimed: true };
    const newStart = {
      ...repeat,
      entireSeriesCost: { day: dec7, reason: "newStart" } as const,
    };
    expect(off(newStart)).toEqual(["all", "this"]);
    expect(eventSaveDescription(newStart)).toBe(
      "Changing the time for the entire series would reset your changed Dec 7 meeting. A new repeat applies from this occurrence on."
    );
  });

  test("still reads the field it replaces, droppedMovedDay", () => {
    expect(
      off({ ...none, droppedMovedDay: dec7, patternChanged: true })
    ).toEqual(["all", "this"]);
    expect(off({ ...none, droppedMovedDay: dec7 })).toEqual([]);
  });
});

describe("a new time for a series of several rules", () => {
  const changes = { ...none, retimed: true, severalRules: true };

  test("applies to this occurrence only, and says why", () => {
    const occurrence = { ...changes, splitBlocked: "severalRules" as const };
    expect(off(occurrence)).toEqual(["all", "following"]);
    expect(eventSaveDescription(occurrence)).toBe(
      "This and following isn't available for a series with more than one rule. A new time applies to this occurrence only."
    );
    // Opened from the series itself (no occurrence to split at).
    expect(off(changes)).toEqual(["all"]);
    expect(eventSaveDescription(changes)).toBe(
      "This series' meetings keep times of their own, so its time can't be changed for the entire series. Change one occurrence at a time."
    );
  });

  test("with a new repeat and This and following open, goes from here on", () => {
    // One rule at another hour than the start's: no split block.
    const both = { ...changes, movesSeveralADay: true, patternChanged: true };
    expect(off(both)).toEqual(["all", "this"]);
    expect(eventSaveDescription(both)).toBe(
      "This series' meetings keep times of their own, so a new time can't apply to the entire series. A new repeat applies from this occurrence on."
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
      "This and following isn't available for a series with more than one rule. This series' meetings keep times of their own, so a new time can't apply to the entire series, nor a new repeat to one occurrence. Change the times and the repeat in two saves."
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

describe("the server's refusal of a series write", () => {
  const refused = (data: unknown) =>
    new ORPCError("BAD_REQUEST", { data, message: "Refused." });

  test("is read from the error's typed data, by its reason", () => {
    expect(seriesRefusalOf(refused({ reason: "addedBeforeStart" }))).toEqual({
      reason: "addedBeforeStart",
    });
    expect(
      seriesRefusalOf(
        refused({
          originalStarts: ["2026-12-07T09:00:00-05:00", "2026-12-08"],
          reason: "dropsChangedOccurrences",
        })
      )
    ).toEqual({
      originalStarts: ["2026-12-07T09:00:00-05:00", "2026-12-08"],
      reason: "dropsChangedOccurrences",
    });
  });

  test("reads a length refusal with the meetings it names", () => {
    expect(
      seriesRefusalOf(
        refused({
          originalStarts: ["2026-12-07T09:00:00-05:00"],
          reason: "resizesChangedOccurrences",
        })
      )
    ).toEqual({
      originalStarts: ["2026-12-07T09:00:00-05:00"],
      reason: "resizesChangedOccurrences",
    });
    expect(
      seriesRefusalOf(refused({ reason: "resizesChangedOccurrences" }))
    ).toBeNull();
  });

  test("isn't any other failure", () => {
    expect(seriesRefusalOf(refused({ reason: "somethingNew" }))).toBeNull();
    expect(
      seriesRefusalOf(refused({ reason: "dropsChangedOccurrences" }))
    ).toBeNull();
    expect(seriesRefusalOf(refused(undefined))).toBeNull();
    expect(
      seriesRefusalOf(
        new ORPCError("INTERNAL_SERVER_ERROR", {
          data: { reason: "countUnknown" },
        })
      )
    ).toBeNull();
    expect(seriesRefusalOf(new Error("offline"))).toBeNull();
  });

  test("turns the refused scope off and leads with why, in the server's words", () => {
    const refusal = { reason: "severalTimesADay" } as const;
    const changes = { ...none, refused: refuseSave(null, "all", refusal) };
    expect(off(changes)).toEqual(["all"]);
    expect(eventSaveDescription(changes)).toBe(
      `${refusalMessage(refusal)} ${SCOPE_DIALOG_COPY.saveEvent.description}`
    );
  });

  test("a refused delete keeps This and following off, saying why", () => {
    const refusal = { reason: "deleteFromAddedOccurrence" } as const;
    expect(
      eventDeleteScopeState({
        cutUnsure: false,
        refused: refuseSave(null, "following", refusal),
        seriesRuleLoaded: true,
      })
    ).toEqual({
      description: `${refusalMessage(refusal)} Delete:`,
      disabled: { following: true },
    });
  });

  test("keeps every scope refused for the save off, led by the latest reason", () => {
    const drops = {
      originalStarts: ["2026-12-07T09:00:00-05:00"],
      reason: "dropsChangedOccurrences",
    } as const;
    const first = refuseSave(null, "all", drops);
    const both = refuseSave(first, "following", { reason: "countUnknown" });
    const changes = { ...none, refused: both };
    expect(off(changes)).toEqual(["all", "following"]);
    expect(eventSaveDescription(changes)).toStartWith(
      refusalMessage({ reason: "countUnknown" })
    );
  });
});

describe("This and following, turned off before the server would refuse it", () => {
  const zone = "America/New_York";
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });
  const occurrence = (dateTime: string) => ({
    originalStartTime: at(dateTime),
    recurringEventId: "series",
    start: at(dateTime),
  });

  test("from the series' first meeting, with meetings added before it", () => {
    const master = {
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261102T090000",
      ],
      start: at("2026-11-09T09:00:00-05:00"),
    };
    expect(
      seriesSplitBlock(occurrence("2026-11-09T09:00:00-05:00"), master, zone)
    ).toBe("addedBeforeStart");
    // From the first meeting This and following is the whole series: a
    // second rule doesn't block it there.
    expect(
      seriesSplitBlock(
        occurrence("2026-11-09T09:00:00-05:00"),
        {
          ...master,
          recurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "RRULE:FREQ=WEEKLY;BYDAY=WE",
          ],
        },
        zone
      )
    ).toBeNull();
    expect(
      eventSaveDescription({ ...none, splitBlocked: "addedBeforeStart" })
    ).toBe(refusalMessage({ reason: "addedBeforeStart" }));
  });

  test("where the series' COUNT left can't be worked out", () => {
    // Five times by a rule the app can't walk (BYWEEKNO), with an added
    // day: Google's own list can't tell the added meeting apart either.
    const master = {
      recurrence: [
        "RRULE:FREQ=YEARLY;BYWEEKNO=46,47,48;BYDAY=MO;COUNT=5",
        "RDATE;TZID=America/New_York:20261111T090000",
      ],
      start: at("2026-11-09T09:00:00-05:00"),
    };
    const later = occurrence("2026-11-16T09:00:00-05:00");
    expect(seriesSplitBlock(later, master, zone)).toBe("countUnknown");
    // A new COUNT isn't carried: nothing to work out.
    expect(
      seriesSplitBlock(later, master, zone, [
        "RRULE:FREQ=YEARLY;BYWEEKNO=46,47,48;BYDAY=MO;COUNT=2",
      ])
    ).toBeNull();
    // Without an added day the server counts from Google's own list.
    expect(
      seriesSplitBlock(
        later,
        { ...master, recurrence: [master.recurrence[0] ?? ""] },
        zone
      )
    ).toBeNull();
    // Nor with a skip before the split: whether it was a meeting is in
    // Google's list, which only the server reads.
    expect(
      seriesSplitBlock(
        later,
        {
          ...master,
          recurrence: [
            master.recurrence[0] ?? "",
            "EXDATE;TZID=America/New_York:20261109T090000",
          ],
        },
        zone
      )
    ).toBeNull();
  });
});

test("a series start without an offset is read in its own zone", () => {
  const start = {
    dateTime: "2026-11-02T09:00:00",
    timeZone: "America/New_York",
  };
  const several = (recurrence: string[]) =>
    seriesMeetsSeveralTimesADay({ recurrence, start }, "America/New_York");
  expect(several(["RRULE:FREQ=WEEKLY"])).toBe(false);
  expect(several(["RRULE:FREQ=WEEKLY;BYHOUR=15"])).toBe(true);
  // A COUNT the app can walk, with an added day, carries on as with an
  // offset: the split and the series' start are read as the server does.
  const local = (dateTime: string) => ({
    dateTime,
    timeZone: "America/New_York",
  });
  const master = {
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
      "RDATE;TZID=America/New_York:20261111T090000",
    ],
    start: local("2026-11-09T09:00:00"),
  };
  const later = {
    originalStartTime: local("2026-11-16T09:00:00"),
    recurringEventId: "series",
    start: local("2026-11-16T09:00:00"),
  };
  expect(seriesSplitBlock(later, master, "America/New_York")).toBeNull();
  // And the added Nov 11 meeting is still read as one.
  const added = {
    ...later,
    originalStartTime: local("2026-11-11T09:00:00"),
    start: local("2026-11-11T09:00:00"),
  };
  expect(seriesSplitBlock(added, master, "America/New_York")).toBe(
    "addedOccurrence"
  );
});

test("a series meets several times a day by two rules, or one at its own hour", () => {
  const start = {
    dateTime: "2026-11-09T09:00:00-05:00",
    timeZone: "America/New_York",
  };
  const several = (recurrence: string[]) =>
    seriesMeetsSeveralTimesADay({ recurrence, start }, "America/New_York");
  expect(several(["RRULE:FREQ=WEEKLY;BYDAY=MO"])).toBe(false);
  expect(several(["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"])).toBe(false);
  expect(several(["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15"])).toBe(true);
  expect(
    several([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
    ])
  ).toBe(true);
});
