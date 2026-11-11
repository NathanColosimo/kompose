import { describe, expect, test } from "bun:test";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { getTagTaskSections } from "./hooks/use-tag-task-sections";
import { getTaskSections } from "./hooks/use-task-sections";
import {
  deriveTaskPresentation,
  type TaskPresentation,
  type TaskSearchDestination,
} from "./task-presentation";
import {
  createCommandBarTaskOpenRequest,
  deserializeCommandBarTaskOpenRequest,
  serializeCommandBarTaskOpenRequest,
} from "./task-search-routing";

const today = Temporal.PlainDate.from("2026-11-06");
const past = today.subtract({ days: 1 });
const future = today.add({ days: 1 });
const timeZone = "America/New_York";
const now = Temporal.ZonedDateTime.from(
  "2026-11-06T12:00-05:00[America/New_York]"
);
const context = { now, timeZone, today };
const tag: TaskSelectDecoded["tags"][number] = {
  createdAt: now.toInstant().toString(),
  icon: "Tag",
  id: "tag",
  name: "Test tag",
  updatedAt: now.toInstant().toString(),
  userId: "user",
};

function makeTask(
  overrides: Partial<TaskSelectDecoded> = {}
): TaskSelectDecoded {
  return {
    createdAt: now.toInstant(),
    description: null,
    dueDate: null,
    durationMinutes: 30,
    id: "task",
    isException: false,
    links: [],
    recurrence: null,
    seriesMasterId: null,
    startDate: null,
    startTime: null,
    status: "todo",
    tags: [tag],
    title: "Test task",
    updatedAt: now.toInstant(),
    userId: "user",
    ...overrides,
  };
}

describe("task presentation regressions", () => {
  test("an untimed task starting and due today belongs in Unplanned", () => {
    const task = makeTask({ dueDate: today, startDate: today });
    expect(deriveTaskPresentation(task, context).section).toBe("unplanned");
  });

  test("search opens today's date for an older overdue untimed task", () => {
    const task = makeTask({ dueDate: past, startDate: past });
    const { destination } = deriveTaskPresentation(task, context);
    expect(destination.kind).toBe("sidebar");
    if (destination.kind !== "sidebar") {
      throw new Error("Expected a sidebar destination");
    }
    expect(destination.view).toBe("today");
    expect(destination.date?.toString()).toBe(today.toString());
  });
});

type Section = TaskPresentation["section"];
type Four<T> = readonly [T, T, T, T];

const inboxDestination = "sidebar:inbox:";
const todayDestination = `sidebar:today:${today}`;
const pastDestination = `sidebar:today:${past}`;
const futureDestination = `sidebar:today:${future}`;
const pastCalendar = `calendar:${past}`;
const todayCalendar = `calendar:${today}`;
const futureCalendar = `calendar:${future}`;
const startTime = Temporal.PlainTime.from("13:00");

// Each row specifies the four due-date cases: null, past, today, future.
// Historical/future date views retain their date-specific scheduling sections.
const matrix: {
  destinations: Four<string>;
  doneDestination: string;
  futureSection: Section;
  inbox: boolean;
  name: string;
  pastSection: Section;
  startDate: Temporal.PlainDate | null;
  startTime: Temporal.PlainTime | null;
  todaySections: Four<Section>;
}[] = [
  {
    destinations: [
      inboxDestination,
      inboxDestination,
      inboxDestination,
      inboxDestination,
    ],
    doneDestination: todayDestination,
    futureSection: null,
    inbox: true,
    name: "no start date, no time",
    pastSection: null,
    startDate: null,
    startTime: null,
    todaySections: [null, "overdue", null, null],
  },
  {
    destinations: [
      inboxDestination,
      inboxDestination,
      inboxDestination,
      inboxDestination,
    ],
    doneDestination: todayDestination,
    futureSection: null,
    inbox: true,
    name: "no start date, orphaned time",
    pastSection: null,
    startDate: null,
    startTime,
    todaySections: [null, "overdue", null, null],
  },
  {
    destinations: [
      pastDestination,
      todayDestination,
      pastDestination,
      pastDestination,
    ],
    doneDestination: todayDestination,
    futureSection: null,
    inbox: false,
    name: "past start, no time",
    pastSection: "unplanned",
    startDate: past,
    startTime: null,
    todaySections: ["unplanned", "overdue", "unplanned", "unplanned"],
  },
  {
    destinations: [pastCalendar, pastCalendar, pastCalendar, pastCalendar],
    doneDestination: pastCalendar,
    futureSection: null,
    inbox: false,
    name: "past start, timed",
    pastSection: "planned",
    startDate: past,
    startTime,
    todaySections: ["overdue", "overdue", "overdue", "overdue"],
  },
  {
    destinations: [
      todayDestination,
      todayDestination,
      todayDestination,
      todayDestination,
    ],
    doneDestination: todayDestination,
    futureSection: null,
    inbox: false,
    name: "today start, no time",
    pastSection: null,
    startDate: today,
    startTime: null,
    todaySections: ["unplanned", "overdue", "unplanned", "unplanned"],
  },
  {
    destinations: [todayCalendar, todayCalendar, todayCalendar, todayCalendar],
    doneDestination: todayCalendar,
    futureSection: null,
    inbox: false,
    name: "today start, timed",
    pastSection: null,
    startDate: today,
    startTime,
    todaySections: ["planned", "overdue", "planned", "planned"],
  },
  {
    destinations: [
      futureDestination,
      todayDestination,
      futureDestination,
      futureDestination,
    ],
    doneDestination: todayDestination,
    futureSection: "unplanned",
    inbox: false,
    name: "future start, no time",
    pastSection: null,
    startDate: future,
    startTime: null,
    todaySections: [null, "overdue", null, null],
  },
  {
    destinations: [
      futureCalendar,
      futureCalendar,
      futureCalendar,
      futureCalendar,
    ],
    doneDestination: futureCalendar,
    futureSection: "planned",
    inbox: false,
    name: "future start, timed",
    pastSection: null,
    startDate: future,
    startTime,
    todaySections: [null, "overdue", null, null],
  },
];

function destinationKey(destination: TaskSearchDestination): string {
  if (destination.kind === "calendar") {
    return `calendar:${destination.date}`;
  }
  if (destination.kind === "sidebar") {
    return `sidebar:${destination.view}:${destination.date ?? ""}`;
  }
  if (destination.kind === "unmapped") {
    return "unmapped";
  }
  return destination satisfies never;
}

const dueDates = [null, past, today, future];
const targetDates = [
  { date: past, section: "pastSection" },
  { date: today, section: "todaySections" },
  { date: future, section: "futureSection" },
] satisfies {
  date: Temporal.PlainDate;
  section: "pastSection" | "todaySections" | "futureSection";
}[];

for (const row of matrix) {
  for (const [dueIndex, dueDate] of dueDates.entries()) {
    for (const done of [false, true]) {
      for (const target of targetDates) {
        test(`${row.name}; due=${dueDate}; done=${done}; target=${target.date}`, () => {
          const task = makeTask({
            dueDate,
            startDate: row.startDate,
            startTime: row.startTime,
            status: done ? "done" : "todo",
          });
          const ctx = { ...context, targetDate: target.date };
          let expectedSection = row.pastSection;
          if (target.section === "todaySections") {
            expectedSection = row.todaySections[dueIndex] ?? null;
          } else {
            expectedSection = row[target.section];
          }
          if (done) {
            expectedSection = target.date.equals(today) ? "done" : null;
          }

          const presentation = deriveTaskPresentation(task, ctx);
          expect(presentation.inbox).toBe(!done && row.inbox);
          expect(presentation.section).toBe(expectedSection);
          const expectedDestination = done
            ? row.doneDestination
            : row.destinations[dueIndex];
          if (expectedDestination === undefined) {
            throw new Error("Missing expected destination in test matrix");
          }
          expect(destinationKey(presentation.destination)).toBe(
            expectedDestination
          );

          const sections = getTaskSections([task], ctx);
          expect(sections.inboxTasks).toEqual(!done && row.inbox ? [task] : []);
          expect(sections.plannedTasks).toEqual(
            expectedSection === "planned" ? [task] : []
          );
          expect(sections.unplannedTasks).toEqual(
            expectedSection === "unplanned" ? [task] : []
          );
          expect(sections.overdueTasks).toEqual(
            expectedSection === "overdue" ? [task] : []
          );
          expect(sections.doneTasks).toEqual(
            expectedSection === "done" ? [task] : []
          );

          const tagged = getTagTaskSections([task], tag.id, ctx);
          const tagOverdue = !done && row.todaySections[dueIndex] === "overdue";
          expect(tagged.doneTasks).toEqual(done ? [task] : []);
          expect(tagged.overdueTasks).toEqual(tagOverdue ? [task] : []);
          expect(tagged.todoTasks).toEqual(done || tagOverdue ? [] : [task]);

          // Opening a sidebar result must mount the task even if another day
          // was selected when the search started.
          if (presentation.destination.kind === "sidebar") {
            const mounted = getTaskSections([task], {
              ...context,
              targetDate: presentation.destination.date ?? future,
            });
            if (presentation.destination.view === "inbox") {
              expect(mounted.inboxTasks).toContain(task);
            } else {
              expect([
                ...mounted.plannedTasks,
                ...mounted.unplannedTasks,
                ...mounted.overdueTasks,
                ...mounted.doneTasks,
              ]).toContain(task);
            }
          }
        });
      }
    }
  }
}

describe("recurring tasks", () => {
  for (const id of ["master", "occurrence"]) {
    test(`${id}: Inbox and tag views exclude the series; Today scopes untouched instances`, () => {
      const recurring = { id, seriesMasterId: "master" };
      const cases = [
        { dueDate: null, expected: null, startDate: null },
        { dueDate: null, expected: null, startDate: past },
        { dueDate: today, expected: null, startDate: past },
        { dueDate: today, expected: "unplanned", startDate: today },
        { dueDate: null, expected: null, startDate: future },
        { dueDate: past, expected: "overdue", startDate: past },
        { dueDate: past, expected: "overdue", startDate: null },
      ] satisfies {
        dueDate: Temporal.PlainDate | null;
        expected: Section;
        startDate: Temporal.PlainDate | null;
      }[];
      for (const { dueDate, expected, startDate } of cases) {
        const task = makeTask({ ...recurring, dueDate, startDate });
        const presentation = deriveTaskPresentation(task, context);
        expect(presentation.inbox).toBe(false);
        expect(presentation.section).toBe(expected);
        expect(getTaskSections([task], context).inboxTasks).toEqual([]);
        expect(getTagTaskSections([task], tag.id, context)).toEqual({
          doneTasks: [],
          overdueTasks: [],
          todoTasks: [],
        });
      }
    });
  }
});

describe("time boundaries", () => {
  test("scheduled end must be strictly before now, including in-progress tasks", () => {
    const task = makeTask({
      startDate: today,
      startTime: Temporal.PlainTime.from("11:30"),
      status: "in_progress",
    });
    expect(deriveTaskPresentation(task, context).section).toBe("planned");
    expect(
      deriveTaskPresentation(task, {
        ...context,
        now: now.add({ nanoseconds: 1 }),
      }).section
    ).toBe("overdue");
    expect(
      destinationKey(deriveTaskPresentation(task, context).destination)
    ).toBe(todayCalendar);
  });

  test("an overnight task is overdue only after its full duration", () => {
    const task = makeTask({
      durationMinutes: 750,
      startDate: past,
      startTime: Temporal.PlainTime.from("23:45"),
    });
    expect(deriveTaskPresentation(task, context).section).toBeNull();
    expect(
      deriveTaskPresentation(task, {
        ...context,
        now: now.add({ minutes: 16 }),
      }).section
    ).toBe("overdue");
    expect(
      destinationKey(deriveTaskPresentation(task, context).destination)
    ).toBe(pastCalendar);
  });

  test("due today remains unplanned until the local date changes", () => {
    const task = makeTask({ dueDate: today, startDate: today });
    expect(
      deriveTaskPresentation(task, {
        ...context,
        now: Temporal.ZonedDateTime.from(
          "2026-11-06T23:59:59-05:00[America/New_York]"
        ),
      }).section
    ).toBe("unplanned");
    const nextDayContext = {
      ...context,
      now: Temporal.ZonedDateTime.from(
        "2026-11-07T00:00-05:00[America/New_York]"
      ),
      today: future,
    };
    const presentation = deriveTaskPresentation(task, nextDayContext);
    expect(presentation.section).toBe("overdue");
    expect(destinationKey(presentation.destination)).toBe(futureDestination);
  });

  test("scheduled duration crosses the DST fall-back hour in elapsed minutes", () => {
    const date = Temporal.PlainDate.from("2026-11-01");
    const task = makeTask({
      durationMinutes: 120,
      startDate: date,
      startTime: Temporal.PlainTime.from("00:30"),
    });
    expect(
      deriveTaskPresentation(task, {
        now: Temporal.ZonedDateTime.from(
          "2026-11-01T01:15-05:00[America/New_York]"
        ),
        timeZone,
        today: date,
      }).section
    ).toBe("planned");
    expect(
      deriveTaskPresentation(task, {
        now: Temporal.ZonedDateTime.from(
          "2026-11-01T01:31-05:00[America/New_York]"
        ),
        timeZone,
        today: date,
      }).section
    ).toBe("overdue");
  });

  test("Done uses the local update date; tag Done includes older completions", () => {
    const task = makeTask({
      dueDate: past,
      startDate: future,
      status: "done",
      updatedAt: Temporal.Instant.from("2026-11-06T02:00:00Z"),
    });
    expect(deriveTaskPresentation(task, context).section).toBeNull();
    expect(
      deriveTaskPresentation(task, { ...context, targetDate: past }).section
    ).toBe("done");
    expect(
      destinationKey(deriveTaskPresentation(task, context).destination)
    ).toBe("unmapped");
    expect(getTagTaskSections([task], tag.id, context).doneTasks).toEqual([
      task,
    ]);
    expect(
      deriveTaskPresentation(task, { ...context, timeZone: "Asia/Tokyo" })
        .section
    ).toBe("done");
  });
});

describe("section grouping and ordering", () => {
  test("Inbox overlaps Overdue and sorts by latest update without reordering date sections", () => {
    const older = makeTask({
      dueDate: past,
      id: "older",
      updatedAt: now.subtract({ hours: 1 }).toInstant(),
    });
    const newest = makeTask({ dueDate: past, id: "newest" });
    const unplanned = makeTask({ id: "unplanned", startDate: today });
    const planned = makeTask({ id: "planned", startDate: today, startTime });
    const done = makeTask({ id: "done", status: "done" });
    const input = Object.freeze([older, unplanned, newest, planned, done]);
    expect(getTaskSections(input, context)).toEqual({
      doneTasks: [done],
      inboxTasks: [newest, older],
      overdueTasks: [older, newest],
      plannedTasks: [planned],
      unplannedTasks: [unplanned],
    });
    expect(input).toEqual([older, unplanned, newest, planned, done]);
  });

  test("tag sections retain overdue, due/start date, and completion ordering", () => {
    const oldestDue = makeTask({
      dueDate: past.subtract({ days: 1 }),
      id: "oldest-due",
    });
    const yesterdayDue = makeTask({ dueDate: past, id: "yesterday-due" });
    const yesterdayTimed = makeTask({
      dueDate: future,
      id: "yesterday-timed",
      startDate: past,
      startTime,
    });
    const todayTimed = makeTask({
      id: "today-timed",
      startDate: today,
      startTime: Temporal.PlainTime.from("08:00"),
    });
    const dueTodayStartsToday = makeTask({
      dueDate: today,
      id: "due-today-starts-today",
      startDate: today,
    });
    const dueTodayStartsFuture = makeTask({
      dueDate: today,
      id: "due-today-starts-future",
      startDate: future,
    });
    const dueFuture = makeTask({ dueDate: future, id: "due-future" });
    const pastStart = makeTask({ id: "past-start", startDate: past });
    const futureStart = makeTask({ id: "future-start", startDate: future });
    const newestInbox = makeTask({ id: "newest-inbox" });
    const oldestInbox = makeTask({
      id: "oldest-inbox",
      updatedAt: now.subtract({ hours: 1 }).toInstant(),
    });
    const newestDone = makeTask({ id: "newest-done", status: "done" });
    const oldestDone = makeTask({
      id: "oldest-done",
      status: "done",
      updatedAt: now.subtract({ days: 2 }).toInstant(),
    });
    const excluded = [
      makeTask({ id: "untagged", tags: [] }),
      makeTask({ id: "other-tag", tags: [{ ...tag, id: "other" }] }),
      makeTask({ id: "master", seriesMasterId: "master" }),
      makeTask({ id: "occurrence", seriesMasterId: "master" }),
    ];
    const input = Object.freeze([
      todayTimed,
      oldestDone,
      futureStart,
      yesterdayTimed,
      oldestInbox,
      dueTodayStartsFuture,
      yesterdayDue,
      newestDone,
      dueFuture,
      pastStart,
      newestInbox,
      oldestDue,
      dueTodayStartsToday,
      ...excluded,
    ]);
    expect(getTagTaskSections(input, tag.id, context)).toEqual({
      doneTasks: [newestDone, oldestDone],
      overdueTasks: [oldestDue, yesterdayDue, yesterdayTimed, todayTimed],
      todoTasks: [
        dueTodayStartsToday,
        dueTodayStartsFuture,
        dueFuture,
        pastStart,
        futureStart,
        newestInbox,
        oldestInbox,
      ],
    });
  });

  test("empty lists and absent tag selection produce empty sections", () => {
    expect(getTaskSections([], context)).toEqual({
      doneTasks: [],
      inboxTasks: [],
      overdueTasks: [],
      plannedTasks: [],
      unplannedTasks: [],
    });
    const emptyTags = { doneTasks: [], overdueTasks: [], todoTasks: [] };
    expect(getTagTaskSections([], tag.id, context)).toEqual(emptyTags);
    expect(getTagTaskSections([makeTask()], null, context)).toEqual(emptyTags);
  });
});

test("overdue search navigation carries today's date through desktop serialization", () => {
  const task = makeTask({ dueDate: past, startDate: past });
  const { destination } = deriveTaskPresentation(task, {
    ...context,
    targetDate: future,
  });
  if (destination.kind === "unmapped") {
    throw new Error("Expected a mapped overdue task");
  }
  const request = createCommandBarTaskOpenRequest({
    destination,
    taskId: task.id,
  });
  const serialized = serializeCommandBarTaskOpenRequest(request);
  expect(serialized.date).toBe("2026-11-06");
  expect(serialized.sidebarView).toBe("today");
  expect(serialized.target).toBe("sidebar");
  expect(serialized.taskId).toBe(task.id);
  const restored = deserializeCommandBarTaskOpenRequest(serialized);
  expect(restored.date?.equals(today)).toBe(true);
  expect(
    getTaskSections([task], { ...context, targetDate: restored.date })
      .overdueTasks
  ).toEqual([task]);
});
