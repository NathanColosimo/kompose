import { describe, expect, test } from "bun:test";
import { refusalMessage } from "@kompose/google-cal/series-edits";
import { ORPCError } from "@orpc/client";
import {
  chosenScope,
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
  opensSeries,
  RECURRENCE_SCOPE_OPTIONS,
  refusalReason,
  refuseSave,
  SCOPE_DIALOG_COPY,
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

/** Why This and following is off for a split block, in the server's words. */
const addedWhy = SCOPE_DIALOG_COPY.splitBlocked.addedOccurrence;
const severalWhy = SCOPE_DIALOG_COPY.splitBlocked.severalRules;

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

/**
 * Every combination of the save's own inputs, once with each of these
 * refusals, as its own test (the whole matrix is too slow for one). A
 * failed load is only one that hasn't loaded.
 */
const refusalCases = [
  ["no refusal", null],
  [
    "Entire series refused",
    refuseSave(null, "all", {
      originalStarts: ["2026-12-07T09:00:00-05:00"],
      reason: "dropsChangedOccurrences",
    }),
  ],
  [
    "This and following refused",
    refuseSave(null, "following", { reason: "countUnknown" }),
  ],
] as const;
for (const [refusedLabel, refused] of refusalCases) {
  test(`says why whenever a scope is off (${refusedLabel})`, () => {
    const plain = SCOPE_DIALOG_COPY.saveEvent.description;
    const flags = [false, true] as const;
    const all = combinations({
      calendarChanged: flags,
      dateMoved: flags,
      opensSeries: flags,
      patternChanged: flags,
      repeatSkips: [null, "day", "end"],
      retimed: flags,
      series: [
        { seriesRuleFailed: false, seriesRuleLoaded: true },
        { seriesRuleFailed: false, seriesRuleLoaded: false },
        { seriesRuleFailed: true, seriesRuleLoaded: false },
      ],
      severalRules: flags,
      movesSeveralADay: [undefined, false, true],
      splitBlocked: [null, "addedOccurrence", "severalRules"],
    } as const);
    for (const { series, ...rest } of all) {
      const changes = { ...rest, ...series, refused };
      const disabled = eventSaveDisabledScopes(changes);
      const line = eventSaveDescription(changes);
      expect(line === plain).toBe(Object.keys(disabled).length === 0);
      // The plain prompt only ends a line, never one with no scope left.
      if (line.includes(plain)) {
        expect(line.endsWith(plain)).toBe(true);
        expect(
          Boolean(disabled.all && disabled.following && disabled.this)
        ).toBe(false);
      }
    }
  });
}

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
  // A calendar move whose new time can't apply to a series of several
  // rules.
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
    "This occurrence has moved to another day, so your changes apply to it alone or from it on."
  );
  expect(
    eventSaveDescription({ ...none, dateMoved: true, seriesRuleLoaded: false })
  ).toBe(
    "This occurrence has moved to another day, so your changes apply to it alone or from it on. Loading the series… This and following is available once it loads."
  );
  // A new repeat on a new day can only go from here on.
  expect(
    eventSaveDescription({ ...none, dateMoved: true, patternChanged: true })
  ).toBe(
    "This occurrence has moved to another day, so a new repeat applies from it on."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      patternChanged: true,
      seriesTimeZone: "Asia/Tokyo",
    })
  ).toBe(
    "In Tokyo time, this occurrence has moved to another day, so a new repeat applies from it on."
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
    "In Tokyo time, this occurrence has moved to another day, so your changes apply to it alone or from it on."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Etc/GMT-9",
    })
  ).toBe(
    "This occurrence has moved to another day, so your changes apply to it alone or from it on."
  );
  expect(eventSaveDescription({ ...none, calendarChanged: true })).toBe(
    "Moving to another calendar moves the entire series."
  );
  expect(
    eventSaveDescription({ ...none, calendarChanged: true, dateMoved: true })
  ).toBe(
    "Moving to another calendar moves the entire series, but this occurrence has moved to another day, which can't be saved with a calendar change. Change the calendar and the times in two saves."
  );
  expect(
    eventSaveDescription({
      ...none,
      calendarChanged: true,
      patternChanged: true,
      seriesRuleLoaded: false,
    })
  ).toBe(
    "Moving to another calendar moves the entire series. Loading the series… A new repeat can be saved once it loads."
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
  expect(eventSaveDescription(blocked)).toBe(addedWhy);
  expect(off({ ...blocked, dateMoved: true })).toEqual(["all", "following"]);
  // A moved day keeps its own sentence, with the reason after it.
  expect(eventSaveDescription({ ...blocked, dateMoved: true })).toBe(
    `This occurrence has moved to another day, so your changes apply to it alone. ${addedWhy}`
  );
  // A new repeat can then only go to the entire series.
  expect(eventSaveDescription({ ...blocked, patternChanged: true })).toBe(
    `${addedWhy} A new repeat applies to the entire series.`
  );
  // A new day and a new repeat at once: no scope fits, and it says so,
  // with the reason that applies.
  const stuck = { ...blocked, dateMoved: true, patternChanged: true };
  expect(off(stuck)).toEqual(["all", "following", "this"]);
  expect(eventSaveDescription(stuck)).toBe(
    `This occurrence has moved to another day, and a new repeat can't apply to it alone. ${addedWhy} Change the times and the repeat in two saves.`
  );
  expect(eventSaveDescription({ ...stuck, splitBlocked: "severalRules" })).toBe(
    `This occurrence has moved to another day, and a new repeat can't apply to it alone. ${severalWhy} Change the times and the repeat in two saves.`
  );
});

test("keeps This and following off until the series loads", () => {
  const loading = { ...none, seriesRuleLoaded: false };
  expect(off(loading)).toEqual(["following"]);
  expect(eventSaveDescription(loading)).toBe(
    "Loading the series… This and following is available once it loads."
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
    "Loading the series… A new repeat can be saved once it loads."
  );
  expect(eventSaveDescription({ ...repeat, seriesRuleFailed: true })).toBe(
    "Couldn't load the series, so a new repeat can't be saved. Try again later."
  );
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
    expect(eventSaveDescription(changes)).toBe(
      "Applied to the entire series, the new repeat would skip this occurrence, so it applies from here on."
    );
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
    `${addedWhy} Applied to the entire series, the new repeat would skip this occurrence. Change the repeat from the series' first occurrence instead.`
  );
  expect(
    eventSaveDescription({
      ...changes,
      repeatSkips: "end",
      splitBlocked: "severalRules",
    })
  ).toBe(
    `${severalWhy} Applied to the entire series, the new repeat would end before this occurrence. Change the repeat from the series' first occurrence instead.`
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
  ).toBe(
    "Applied to the entire series, the new repeat would end before this occurrence, so it applies from here on."
  );
});

describe("from the series' first meeting, where This and following is the whole series", () => {
  test("a new time for a series meeting several times a day is off for both", () => {
    const several = {
      ...none,
      opensSeries: true,
      retimed: true,
      severalRules: true,
    };
    expect(off(several)).toEqual(["all", "following"]);
    expect(eventSaveDescription(several)).toBe(
      "This series has occurrences at different times of day, so a new time can't apply to the entire series. This is the first occurrence, so This and following is the entire series."
    );
    // With a new repeat too, nothing is on: the times and the repeat take
    // two saves.
    const severalRepeat = { ...several, patternChanged: true };
    expect(off(severalRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(severalRepeat)).toBe(
      "This series has occurrences at different times of day, so a new time can't apply to the entire series, nor a new repeat to one occurrence. This is the first occurrence, so This and following is the entire series. Change the times and the repeat in two saves."
    );
  });

  test("a new day moves the whole series", () => {
    // Only Entire series' own rule keeps it off.
    expect(off({ ...none, dateMoved: true, opensSeries: true })).toEqual([
      "all",
    ]);
  });

  test("a new day and time for a series meeting several times a day", () => {
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
      "This occurrence has moved to another day, so your changes apply to it alone. This series has occurrences at different times of day, so a new time can't apply to the entire series. This is the first occurrence, so This and following is the entire series."
    );
    // With a new repeat too, nothing is on: the times and the repeat take
    // two saves.
    const andRepeat = { ...newTime, patternChanged: true };
    expect(off(andRepeat)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(andRepeat)).toBe(
      "This occurrence has moved to another day, and a new repeat can't apply to it alone. This series has occurrences at different times of day, so a new time can't apply to the entire series. This is the first occurrence, so This and following is the entire series. Change the times and the repeat in two saves."
    );
    // A new day alone keeps every meeting's time: only Entire series is off.
    expect(off({ ...twice, movesSeveralADay: false })).toEqual(["all"]);
  });
});

describe("a new time for a series of several rules", () => {
  const changes = { ...none, retimed: true, severalRules: true };

  test("is a new time of day, not a new form or length", () => {
    // All day, or a new length: the server keeps every meeting's time.
    expect(off({ ...changes, movesSeveralADay: false })).toEqual([]);
    expect(off({ ...changes, movesSeveralADay: true })).toEqual(["all"]);
    // Callers that don't say yet: any new start is taken as a new time.
    expect(off(changes)).toEqual(["all"]);
  });

  test("applies to this occurrence only, and says why", () => {
    const occurrence = { ...changes, splitBlocked: "severalRules" as const };
    expect(off(occurrence)).toEqual(["all", "following"]);
    expect(eventSaveDescription(occurrence)).toBe(
      `${severalWhy} This series has occurrences at different times of day, so a new time can't apply to the entire series. A new time applies to this occurrence only.`
    );
    // No split block (one rule at another hour than the start's):
    // This and following takes the new time.
    expect(off(changes)).toEqual(["all"]);
    expect(eventSaveDescription(changes)).toBe(
      "This series has occurrences at different times of day, so a new time can't apply to the entire series. A new time applies to this occurrence, or from it on."
    );
  });

  test("with a new repeat and This and following open, goes from here on", () => {
    // One rule at another hour than the start's: no split block.
    const both = { ...changes, movesSeveralADay: true, patternChanged: true };
    expect(off(both)).toEqual(["all", "this"]);
    expect(eventSaveDescription(both)).toBe(
      "This series has occurrences at different times of day, so a new time can't apply to the entire series. A new repeat applies from this occurrence on."
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
      `${severalWhy} This series has occurrences at different times of day, so a new time can't apply to the entire series, nor a new repeat to one occurrence. Change the times and the repeat in two saves.`
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
      "Moving to another calendar moves the entire series. Loading the series… Entire series is available once it loads."
    );
    expect(eventSaveDescription({ ...move, seriesRuleFailed: true })).toBe(
      "Moving to another calendar moves the entire series. Couldn't load the series, so the move and the new time can't be saved together. Try again later."
    );
  });

  test("a series of one rule takes a new time in full", () => {
    expect(off({ ...changes, severalRules: false })).toEqual([]);
  });

  test("waits for the series, which says how many rules it has", () => {
    const loading = { ...none, retimed: true, seriesRuleLoaded: false };
    expect(off(loading)).toEqual(["all", "following"]);
    expect(eventSaveDescription(loading)).toBe(
      "Loading the series… This and following and Entire series are available once it loads."
    );
    expect(eventSaveDescription({ ...loading, seriesRuleFailed: true })).toBe(
      "Couldn't load the series, so the new time applies to this occurrence only. Try again later for the rest."
    );
  });
});

describe("the server's refusal of a series write", () => {
  const refused = (data: unknown) =>
    new ORPCError("BAD_REQUEST", { data, message: "Refused." });
  const drops = {
    originalStarts: ["2026-12-07T09:00:00-05:00", "2026-12-08"],
    reason: "dropsChangedOccurrences",
  } as const;

  test("is read from the error's typed data, by its reason", () => {
    expect(seriesRefusalOf(refused({ reason: "otherAppRepeat" }))).toEqual({
      reason: "otherAppRepeat",
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

  test("keeps what else the server says of the occurrences it names", () => {
    // A refusal the server isn't sure of is worded as one.
    const unsure = { ...drops, seriesOnly: true, unsure: true } as const;
    expect(seriesRefusalOf(refused(unsure))).toEqual(unsure);
    expect(refusalReason(unsure)).toStartWith("This may undo");
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

  test("turns the refused scope off and leads with why", () => {
    const refusal = { reason: "severalTimesADay" } as const;
    const changes = { ...none, refused: refuseSave(null, "all", refusal) };
    expect(off(changes)).toEqual(["all"]);
    expect(eventSaveDescription(changes)).toBe(
      `${refusalReason(refusal)} ${SCOPE_DIALOG_COPY.saveEvent.description}`
    );
  });

  test("says why without the server's advice on where else to save", () => {
    // The dialog says that from the scopes still on.
    expect(refusalReason(drops)).toBe(
      "This would undo what was changed or deleted on single occurrences (Dec 7, Dec 8), so it wasn't saved."
    );
    expect(
      refusalReason({ ...drops, reason: "resizesChangedOccurrences" })
    ).toBe(
      "This would also change the length of single occurrences given a length of their own (Dec 7, Dec 8), so it wasn't saved."
    );
    expect(refusalReason({ reason: "countUnknown" })).toBe(
      "This and following isn't available for this series: a clock change skips its time on an earlier day that also has a skipped or added occurrence, so how many times it has left to repeat can't be worked out."
    );
    expect(refusalReason({ reason: "otherAppRepeat" })).toBe(
      "This series repeats in a way made in another app (meetings added outside its repeat, or a set hour in its rule), so this change to its time, all-day setting or repeat can't be saved here without bringing back or cancelling a meeting."
    );
    expect(refusalReason({ reason: "endsBeforeStart" })).toBe(
      "The repeat ends before this occurrence, so it can't start a new series here."
    );
    expect(refusalReason({ reason: "severalTimesADay" })).toBe(
      "This series meets at several set times each day, so one new time can't replace them for the entire series."
    );
  });

  test("keeps the server's words whole where they give no advice", () => {
    const reasons = [
      { reason: "addedOccurrence" },
      { reason: "severalRules" },
    ] as const;
    for (const refusal of reasons) {
      expect(refusalReason(refusal)).toBe(refusalMessage(refusal));
    }
  });

  test("from the first meeting, a refusal for one scope is for both", () => {
    // The server saves This and following there as the entire series.
    const first = { ...none, opensSeries: true };
    const all = { ...first, refused: refuseSave(null, "all", drops) };
    expect(off(all)).toEqual(["all", "following"]);
    expect(eventSaveDescription(all)).toBe(
      `${refusalReason(drops)} This is the first occurrence, so This and following is the entire series. Apply your changes to:`
    );
    const following = {
      ...first,
      refused: refuseSave(null, "following", drops),
    };
    expect(off(following)).toEqual(["all", "following"]);
    expect(eventSaveDescription(following)).toBe(
      `${refusalReason(drops)} This is the first occurrence, so This and following is the entire series. Apply your changes to:`
    );
  });

  test("says where the save can still go, from the scopes left", () => {
    // Entire series refused for a new repeat: only This and following.
    const repeat = {
      ...none,
      patternChanged: true,
      refused: refuseSave(null, "all", drops),
    };
    expect(off(repeat)).toEqual(["all", "this"]);
    expect(eventSaveDescription(repeat)).toBe(
      `${refusalReason(drops)} A new repeat applies from this occurrence on.`
    );
    // This and following refused: a new day applies to the occurrence
    // alone, a new repeat to the entire series, and one that skips this
    // occurrence nowhere from here.
    const following = refuseSave(null, "following", { reason: "countUnknown" });
    const unknown = refusalReason({ reason: "countUnknown" });
    expect(
      eventSaveDescription({ ...none, dateMoved: true, refused: following })
    ).toBe(
      `${unknown} This occurrence has moved to another day, so your changes apply to it alone.`
    );
    expect(
      eventSaveDescription({
        ...none,
        patternChanged: true,
        refused: following,
      })
    ).toBe(`${unknown} A new repeat applies to the entire series.`);
    expect(
      eventSaveDescription({
        ...none,
        patternChanged: true,
        refused: following,
        repeatSkips: "day",
      })
    ).toBe(
      `${unknown} Applied to the entire series, the new repeat would skip this occurrence. Change the repeat from the series' first occurrence instead.`
    );
    // Refused for undoing meetings: changing the repeat from the first
    // meeting would undo them too, so keep them.
    const named = refuseSave(null, "following", drops);
    for (const repeatSkips of ["day", "end"] as const) {
      expect(
        eventSaveDescription({
          ...none,
          patternChanged: true,
          refused: named,
          repeatSkips,
        })
      ).toEndWith(SCOPE_DIALOG_COPY.keepRefusedMeetings);
    }
    // The same block found again after the refusal is said once.
    const several = { reason: "severalRules" } as const;
    expect(
      eventSaveDescription({
        ...none,
        refused: refuseSave(null, "following", several),
        splitBlocked: "severalRules",
      })
    ).toBe(
      `${refusalReason(several)} ${SCOPE_DIALOG_COPY.saveEvent.description}`
    );
    // A blocked split and a refused Entire series: Only this, said plainly.
    expect(
      eventSaveDescription({
        ...none,
        refused: refuseSave(null, "all", { reason: "severalTimesADay" }),
        retimed: true,
        splitBlocked: "addedOccurrence",
      })
    ).toBe(
      `${refusalReason({ reason: "severalTimesADay" })} ${refusalReason({ reason: "addedOccurrence" })}`
    );
    // A calendar move refused: the move goes on its own.
    const resizes = { ...drops, reason: "resizesChangedOccurrences" } as const;
    const move = {
      ...none,
      calendarChanged: true,
      refused: refuseSave(null, "all", resizes),
    };
    expect(off(move)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(move)).toBe(
      `${refusalReason(resizes)} Moving to another calendar moves the entire series, so change the calendar in a save of its own first.`
    );
  });

  test("while the series loads, promises only the scopes the server didn't refuse", () => {
    const loading = { ...none, seriesRuleLoaded: false };
    const following = refuseSave(null, "following", { reason: "countUnknown" });
    const unknown = refusalReason({ reason: "countUnknown" });
    const all = refuseSave(null, "all", drops);
    // Loading would open only what the server refused: nothing to wait for.
    expect(eventSaveDescription({ ...loading, refused: following })).toBe(
      `${unknown} Apply your changes to:`
    );
    expect(
      eventSaveDescription({ ...loading, refused: following, retimed: true })
    ).toBe(
      `${unknown} Loading the series… Entire series is available once it loads.`
    );
    expect(
      eventSaveDescription({ ...loading, refused: all, retimed: true })
    ).toBe(`${refusalReason(drops)} ${SCOPE_DIALOG_COPY.seriesLoading}`);
    // A new repeat neither scope will take: no scope is left.
    expect(
      eventSaveDescription({
        ...loading,
        patternChanged: true,
        refused: refuseSave(all, "following", { reason: "countUnknown" }),
      })
    ).toBe(
      `${unknown} ${refusalReason(drops)} A new repeat can't apply to one occurrence either. Pick a repeat that keeps those occurrences.`
    );
    // A calendar move, which only Entire series takes.
    expect(
      eventSaveDescription({
        ...loading,
        calendarChanged: true,
        refused: all,
        retimed: true,
      })
    ).toBe(
      `${refusalReason(drops)} Moving to another calendar moves the entire series, so change the calendar in a save of its own first.`
    );
    // A new day: the occurrence alone, with nothing to wait for.
    expect(
      eventSaveDescription({
        ...loading,
        dateMoved: true,
        refused: following,
        retimed: true,
      })
    ).toBe(
      `${unknown} This occurrence has moved to another day, so your changes apply to it alone.`
    );
    // Failing to load: no retry for what the server refused.
    const failed = { ...loading, seriesRuleFailed: true };
    expect(eventSaveDescription({ ...failed, refused: following })).toBe(
      `${unknown} Apply your changes to:`
    );
    expect(
      eventSaveDescription({
        ...failed,
        refused: refuseSave(all, "following", { reason: "countUnknown" }),
        retimed: true,
      })
    ).toBe(`${unknown} ${refusalReason(drops)} Apply your changes to:`);
    expect(
      eventSaveDescription({ ...failed, dateMoved: true, refused: following })
    ).toBe(
      `${unknown} This occurrence has moved to another day, so your changes apply to it alone.`
    );
    // From the first meeting, a refusal for one scope is for both.
    const first = { ...loading, opensSeries: true, retimed: true };
    for (const refusal of [all, refuseSave(null, "following", drops)]) {
      expect(eventSaveDescription({ ...first, refused: refusal })).toBe(
        `${refusalReason(drops)} This is the first occurrence, so This and following is the entire series. Apply your changes to:`
      );
      expect(
        eventSaveDescription({
          ...first,
          patternChanged: true,
          refused: refusal,
        })
      ).toBe(
        `${refusalReason(drops)} A new repeat can't apply to one occurrence either. This is the first occurrence, so This and following is the entire series. Save the new times on their own first.`
      );
      expect(
        eventSaveDescription({
          ...first,
          calendarChanged: true,
          refused: refusal,
        })
      ).toBe(
        `${refusalReason(drops)} Moving to another calendar moves the entire series, so change the calendar in a save of its own first.`
      );
    }
  });

  test("never offers a refused scope in its line", () => {
    // Refused This and following for a new repeat: the line says where
    // the repeat can still go.
    const unknown = { reason: "countUnknown" } as const;
    const changes = {
      ...none,
      patternChanged: true,
      refused: refuseSave(null, "following", unknown),
    };
    expect(off(changes)).toEqual(["following", "this"]);
    expect(eventSaveDescription(changes)).toBe(
      `${refusalReason(unknown)} A new repeat applies to the entire series.`
    );
  });

  test("says when the refusals leave no scope at all", () => {
    // Even Only this refused: nothing the dialog offers can save it.
    const changes = {
      ...none,
      refused: refuseSave(
        refuseSave(refuseSave(null, "all", drops), "following", {
          reason: "countUnknown",
        }),
        "this",
        { reason: "severalRules" }
      ),
    };
    expect(off(changes)).toEqual(["all", "following", "this"]);
    expect(eventSaveDescription(changes)).toEndWith(
      SCOPE_DIALOG_COPY.noScopeLeft
    );
  });

  test("keeps every scope refused for the save off, with each reason, latest first", () => {
    const first = refuseSave(null, "all", drops);
    const both = refuseSave(first, "following", { reason: "countUnknown" });
    const changes = { ...none, refused: both };
    expect(off(changes)).toEqual(["all", "following"]);
    expect(eventSaveDescription(changes)).toStartWith(
      `${refusalReason({ reason: "countUnknown" })} ${refusalReason(drops)}`
    );
    // A reason given again moves to the front, said once, from the end of
    // the message or from its middle.
    expect(refuseSave(both, "this", drops).message).toBe(
      `${refusalReason(drops)} ${refusalReason({ reason: "countUnknown" })}`
    );
    const unknown = { reason: "countUnknown" } as const;
    const several = { reason: "severalRules" } as const;
    const three = refuseSave(
      refuseSave(refuseSave(null, "following", several), "following", unknown),
      "all",
      drops
    );
    expect(refuseSave(three, "following", unknown).message).toBe(
      `${refusalReason(unknown)} ${refusalReason(drops)} ${refusalReason(several)}`
    );
  });
});

describe("This and following from the series' first meeting", () => {
  const zone = "America/New_York";
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });
  const first = {
    originalStartTime: at("2026-11-09T09:00:00-05:00"),
    recurringEventId: "series",
    start: at("2026-11-09T09:00:00-05:00"),
  };
  const twoRules = ["RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=WE"];
  const addedBefore = "RDATE;TZID=America/New_York:20261102T090000";
  const master = (recurrence: string[]) => ({
    recurrence,
    start: at("2026-11-09T09:00:00-05:00"),
  });

  test("is the whole series: a second rule doesn't block it", () => {
    expect(opensSeries(first, master(twoRules), zone)).toBe(true);
    expect(seriesSplitBlock(first, master(twoRules), zone)).toBeNull();
  });

  test("splits there when meetings were added before it", () => {
    const weekly = master(["RRULE:FREQ=WEEKLY;BYDAY=MO", addedBefore]);
    expect(opensSeries(first, weekly, zone)).toBe(false);
    expect(seriesSplitBlock(first, weekly, zone)).toBeNull();
    // A split is blocked there as anywhere.
    expect(
      seriesSplitBlock(first, master([...twoRules, addedBefore]), zone)
    ).toBe("severalRules");
  });

  test("isn't a later meeting's, or known before the series loads", () => {
    const later = {
      ...first,
      originalStartTime: at("2026-11-16T09:00:00-05:00"),
      start: at("2026-11-16T09:00:00-05:00"),
    };
    expect(opensSeries(later, master(["RRULE:FREQ=WEEKLY"]), zone)).toBe(false);
    expect(opensSeries(first, null, zone)).toBe(false);
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
  // With an added day, the split and the series' start are read as the
  // server does, as with an offset.
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
