# Temporal API Usage

Kompose uses `temporal-polyfill` for date/time handling. Prefer Temporal's
constructors and methods directly; reserve helpers for domain logic, formatting,
and native `Date` boundaries.

## Core types

| Type | Use |
| --- | --- |
| `PlainDate` | Calendar dates: task start dates and due dates |
| `PlainTime` | Time of day: task start times |
| `ZonedDateTime` | A date and time in a timezone: calendar positions and event bounds |
| `Instant` | UTC timestamps: task creation/update times and API instants |

`currentDateAtom` stores a `PlainDate`; `timezoneAtom` stores a timezone ID.
Both live in `packages/state/src/atoms/current-date.ts`.

## Task scheduling

Task dates and times are separate database fields in
`packages/db/src/schema/task.ts`:

```ts
dueDate: date("due_date", { mode: "string" }),     // "2025-12-15"
startDate: date("start_date", { mode: "string" }), // "2025-12-15"
startTime: time("start_time"),                    // "09:30:00"
```

A task is scheduled on the calendar only when both `startDate` and `startTime`
are present. Combine the decoded values with the user's timezone when an instant
or calendar position is needed:

```ts
const start = task.startDate.toZonedDateTime({
  plainTime: task.startTime,
  timeZone,
});
const end = start.add({ minutes: task.durationMinutes });
```

The task contract in `packages/api/src/routers/task/contract.ts` uses Zod codecs
from `packages/api/src/lib/temporal-codecs.ts`:

- `plainDateCodec`: `YYYY-MM-DD` ↔ `Temporal.PlainDate`
- `plainTimeCodec`: time string ↔ `Temporal.PlainTime`
- `instantCodec`: timestamp string ↔ `Temporal.Instant` for `createdAt` and `updatedAt`

`useTasks` in `packages/state/src/hooks/use-tasks.ts` encodes mutation inputs and
decodes responses. Callers pass Temporal values, not UTC timestamps, for task
scheduling:

```ts
updateTask.mutate({
  id: task.id,
  scope: "this",
  task: {
    startDate: target.toPlainDate(),
    startTime: target.toPlainTime(),
  },
});
```

## Shared and web helpers

`packages/state/src/temporal-utils.ts` (`@kompose/state/temporal-utils`) owns:

- `getSystemTimeZone()`
- `todayPlainDate(timeZone?)`
- `startOfDayZoned(date, timeZone)`
- `endOfDayZoned(date, timeZone)` — the exclusive end, at the start of the next day

`apps/web/src/lib/temporal-utils.ts` imports those day-bound helpers and adds:

- Calendar math: `getDayBoundsZoned`, `isSameDay`, `clampZonedDateTime`, `minutesFromMidnight`
- Display: `formatPlainDate`, `formatTime`, `formatHourLabel`, `formatDuration`
- Timestamp parsing: `isoStringToZonedDateTime`
- Native `Date` boundaries: `zonedDateTimeToDate`, `temporalToPickerDate`,
  `pickerDateToTemporal`, `dateToDateString`, `formatTimeString`

## UI boundaries

Web date pickers expect native `Date` objects. Convert at the boundary while
keeping form state as Temporal values:

```tsx
<Calendar
  selected={field.value ? temporalToPickerDate(field.value) : undefined}
  onSelect={(date) => field.onChange(date ? pickerDateToTemporal(date) : null)}
/>
```

These picker helpers preserve the local calendar date without timezone
conversion. `zonedDateTimeToDate` instead preserves an instant.

Never use `date.toISOString().split("T")[0]` for a local date: converting to UTC
can shift the day. Use `dateToDateString` or `pickerDateToTemporal`.

## Timestamp parsing and timezone rules

`isoStringToZonedDateTime(str, timeZone)` handles three timestamp forms:

- A trailing `Z`: parse as an instant, then convert to `timeZone`.
- An explicit offset: parse as an instant, then convert to `timeZone`.
- No offset, including Postgres strings with a space separator: parse as a
  local date-time in `timeZone`.

Task `startTime` is a time-only field; combine it with `startDate` as shown
above instead of passing it to this timestamp parser.

`instantCodec` treats database creation/update timestamps without an offset as
UTC. That differs from the web timestamp helper's local-time interpretation.

For Google Calendar, send a timestamp with an offset or `Z`; timed event
payloads also carry `timeZone` to preserve recurrence behavior. Calendar drag
payloads use offset strings with `timeZoneName: "never"` and
`calendarName: "never"`, rather than bracketed Temporal timezone annotations.

## Date math

Use `.add()`, `.subtract()`, `.with()`, `.since()`, and Temporal comparison
methods directly. For example, `date.with({ day: date.daysInMonth })` finds the
last day of a month, and `end.since(start).total({ unit: "minutes" })` measures a
duration.

Use `.equals()` for Temporal value equality; `===` compares object references.
Timezone-aware arithmetic accounts for DST, so distinguish adding calendar days
from adding a fixed number of hours.
