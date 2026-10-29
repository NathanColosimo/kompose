import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { resolveFields } from "./fields";
import { parseMarkup } from "./spans";

const now = Temporal.ZonedDateTime.from(
  "2026-10-23T10:00:00-04:00[America/New_York]"
);

function fields(marked: string) {
  const { spans, text } = parseMarkup(marked);
  const result = resolveFields({ now, spans, text });
  return {
    ...result,
    dueDate: result.dueDate?.toString() ?? null,
    startDate: result.startDate?.toString() ?? null,
    startTime: result.startTime?.toString() ?? null,
  };
}

describe("resolveFields", () => {
  test("a full task", () => {
    expect(
      fields(
        "[F:remind me to] [T:call mom about the trip] [S:tmrw at 4] for [M:30 min], [D:ask her to bring passports] [G:#family]"
      )
    ).toEqual({
      description: "Ask her to bring passports",
      dueDate: null,
      durationMinutes: 30,
      links: [],
      recurrence: null,
      startDate: "2026-10-24",
      startTime: "16:00:00",
      title: "Call mom about the trip",
    });
  });

  test("joins an interrupted title", () => {
    const result = fields("[T:call] [S:tomorrow] [T:the landlord]");
    expect(result.title).toBe("Call the landlord");
    expect(result.startDate).toBe("2026-10-24");
  });

  test("a split description keeps its punctuation", () => {
    const result = fields(
      "[T:fix the totals] — [D:formula skips row 28]; [D:check tab 3], [D:ask Sam] and [D:send it]"
    );
    expect(result.description).toBe(
      "Formula skips row 28; check tab 3, ask Sam and send it"
    );
  });

  test("drops a leading 'to' left by the filler", () => {
    expect(fields("[F:remind me] [T:to ask Maya for the folder]").title).toBe(
      "Ask Maya for the folder"
    );
    expect(fields("[T:to do list]").title).toBe("To do list");
  });

  test("drops linking words left where a span was cut out", () => {
    expect(fields("[T:stretch for] [M:10 minutes]").title).toBe("Stretch");
    expect(fields("[T:check in] [S:tomorrow]").title).toBe("Check in");
  });

  test("of two dated start pieces, the first wins", () => {
    const result = fields(
      "[T:call the church office] [S:monday morning] to [D:confirm I can cover the desk] [S:november 4]"
    );
    expect(result.startDate).toBe("2026-10-26");
    const split = fields(
      "[T:order calf feed] [S:tomorrow] after the round, about [S:half nine]"
    );
    expect(split.startTime).toBe("09:30:00");
  });

  test("a corrected date keeps the last one", () => {
    const result = fields(
      "[T:confirm with Priya] by [U:thursday the 29th] [F:actually make that] [U:wednesday the 28th]"
    );
    expect(result.dueDate).toBe("2026-10-28");
  });

  test("a corrected time keeps the last one", () => {
    const result = fields(
      "[T:call back Ms Alvarez] [S:thursday at nine fifteen] no wait [S:nine forty five]"
    );
    expect(result.startDate).toBe("2026-10-29");
    expect(result.startTime).toBe("09:45:00");
  });

  test("a deadline with only a time is on the start's day", () => {
    const result = fields(
      "[T:ulpan hw] start [S:nov 5 at 1:15pm] / due [U:4pm] / [M:35 min]"
    );
    expect(result.startDate).toBe("2026-11-05");
    expect(result.dueDate).toBe("2026-11-05");
    expect(fields("[T:handoff] [S:tomorrow 9am] due [U:930am]").dueDate).toBe(
      "2026-10-24"
    );
  });

  test("a repeat with a start and an end", () => {
    const result = fields(
      "[T:check hives] [R:every other sun 9am] starting [S:oct 25] [R:thru dec 20]"
    );
    expect(result.startDate).toBe("2026-10-25");
    expect(result.startTime).toBe("09:00:00");
    expect(result.recurrence).toEqual({
      byDay: ["SU"],
      freq: "WEEKLY",
      interval: 2,
      until: "2026-12-20",
    });
  });

  test("the last weekday of the month has no repeat but a date", () => {
    const result = fields(
      "[T:renew pass] [R:last weekday of every month at 7:15 am]"
    );
    expect(result.startDate).toBe("2026-10-30");
    expect(result.startTime).toBe("07:15:00");
    expect(result.recurrence).toBeNull();
  });

  test("a start and a deadline", () => {
    const result = fields("[T:draft report] [S:monday], due [U:friday]");
    expect(result.startDate).toBe("2026-10-26");
    expect(result.dueDate).toBe("2026-10-23");
  });

  test("a repeat with a time sets the first start", () => {
    const result = fields("[T:standup] [R:every weekday at 9:30]");
    expect(result.recurrence).toEqual({
      byDay: ["MO", "TU", "WE", "TH", "FR"],
      freq: "WEEKLY",
      interval: 1,
    });
    expect(result.startDate).toBe("2026-10-26");
    expect(result.startTime).toBe("09:30:00");
  });

  test("a repeat anchored by its start", () => {
    const result = fields(
      "[T:water plants] [R:every monday] starting [S:next week]"
    );
    expect(result.recurrence).toEqual({
      byDay: ["MO"],
      freq: "WEEKLY",
      interval: 1,
    });
    expect(result.startDate).toBe("2026-10-26");
  });

  test("a repeat anchored by its deadline", () => {
    const result = fields("[T:pay rent] [R:every month] by [U:the 1st]");
    expect(result.recurrence).toEqual({
      byMonthDay: 1,
      freq: "MONTHLY",
      interval: 1,
    });
    expect(result.startDate).toBe("2026-11-01");
  });

  test.each([
    [
      "mon wed fri at 6am",
      { byDay: ["MO", "WE", "FR"], freq: "WEEKLY", interval: 1 },
    ],
    ["mwf", { byDay: ["MO", "WE", "FR"], freq: "WEEKLY", interval: 1 }],
    ["nightly", { freq: "DAILY", interval: 1 }],
    ["once a month", { byMonthDay: 23, freq: "MONTHLY", interval: 1 }],
    ["quarterly", { byMonthDay: 23, freq: "MONTHLY", interval: 3 }],
    [
      "m-f",
      { byDay: ["MO", "TU", "WE", "TH", "FR"], freq: "WEEKLY", interval: 1 },
    ],
  ])("understands the repeat %p", (phrase, recurrence) => {
    const result = fields(`[T:stretch] [R:${phrase}]`);
    expect(result.recurrence).toEqual(recurrence as never);
  });

  test("a repeat the schema can't hold keeps its first date", () => {
    const result = fields("[T:book club] [R:first monday of every month]");
    expect(result.recurrence).toBeNull();
    expect(result.startDate).toBe("2026-11-02");
  });

  test("a start listing weekdays repeats on them", () => {
    const result = fields("[T:gym] [S:mon wed fri at 6am]");
    expect(result.recurrence).toEqual({
      byDay: ["MO", "WE", "FR"],
      freq: "WEEKLY",
      interval: 1,
    });
    expect([result.startDate, result.startTime]).toEqual([
      "2026-10-26",
      "06:00:00",
    ]);
  });

  test("alternative weekdays don't repeat", () => {
    const result = fields("[T:dentist] [S:mon or tue]");
    expect([result.recurrence, result.startDate]).toEqual([null, "2026-10-26"]);
  });

  test("a weekly repeat with a deadline keeps its weekly rule", () => {
    expect(
      fields("[T:mow] [R:every other friday] before [U:nov 6]").recurrence
    ).toEqual({ byDay: ["FR"], freq: "WEEKLY", interval: 2 });
  });

  test("normalizes links", () => {
    const result = fields(
      "[T:review] [L:github.com/a/b/pull/1]. [L:https://x.dev/y]"
    );
    expect(result.links).toEqual([
      "https://github.com/a/b/pull/1",
      "https://x.dev/y",
    ]);
  });
});
