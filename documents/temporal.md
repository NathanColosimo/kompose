# Temporal API Usage

This project uses the [Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) via `temporal-polyfill` for date/time handling. This replaces `date-fns` and native `Date` objects in most of the codebase.

## Why Temporal?

- **Timezone-aware**: `ZonedDateTime` explicitly tracks timezone, eliminating ambiguity
- **Immutable**: All operations return new instances
- **Type-safe**: Distinct types for different concepts (`PlainDate` vs `ZonedDateTime` vs `Instant`)
- **No DST bugs**: Handles daylight saving time transitions correctly

## Core Types

| Type | Use Case | Example |
|------|----------|---------|
| `PlainDate` | Calendar dates without time (due dates, start dates) | `2025-12-15` |
| `ZonedDateTime` | Full datetime with timezone (scheduled times, event bounds) | `2025-12-15T09:30[America/New_York]` |
| `Instant` | UTC timestamp (API communication, database) | `2025-12-15T14:30:00Z` |
| `PlainTime` | Time of day without date | `09:30` |

## Philosophy: Use Temporal API Directly

Prefer using Temporal's native `.from()` constructors and methods over thin wrapper functions. This makes code more readable by using the standard API that developers can look up in the [MDN docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal).

```typescript
// ✓ Prefer: Use Temporal API directly
const date = Temporal.PlainDate.from({ year, month, day });
const zdt = Temporal.ZonedDateTime.from({ year, month, day, hour, minute, timeZone });
const duration = end.since(start).total({ unit: "minutes" });

// ✗ Avoid: Thin wrappers that hide the API
const date = plainDateFromYMD(year, month, day);
const zdt = zonedDateTimeFromDateAndTime(date, hour, minute, timeZone);
const duration = durationMinutesBetween(start, end);
```

Utility functions in `temporal-utils.ts` are reserved for:
- **Parsing/formatting** with project-specific logic (e.g., Postgres timestamp format)
- **Domain logic** that combines multiple operations (e.g., `getDayBoundsZoned`)
- **Bridge functions** for native Date interop at UI boundaries

## Architecture

### Database Layer (Drizzle)

All date/time columns use `mode: "string"` to avoid auto-conversion:

```typescript
// packages/db/src/schema/task.ts
dueDate: date("due_date", { mode: "string" }),      // "2025-12-15"
startDate: date("start_date", { mode: "string" }),  // "2025-12-15"
startTime: timestamp("start_time", { mode: "string" }), // "2025-12-15 09:30:00"
```

### State Layer (Jotai Atoms)

Atoms store Temporal types directly:

```typescript
// atoms/current-date.ts
export const currentDateAtom = atom<Temporal.PlainDate>(todayPlainDate());
export const timezoneAtom = atom<string>(getSystemTimeZone());
```

### UI Boundary (React Components)

UI pickers (like shadcn Calendar) expect native `Date` objects. Convert at the boundary:

```typescript
// In form components
import { dateToDateString, dateStringToDate } from "@/lib/temporal-utils";

// Calendar expects Date, form state stores string
<Calendar
  selected={field.value ? dateStringToDate(field.value) : undefined}
  onSelect={(date) => field.onChange(date ? dateToDateString(date) : null)}
/>
```

## Utility Functions

Utilities in `apps/web/src/lib/temporal-utils.ts` handle project-specific concerns. For basic operations, use Temporal API directly.

### Use Temporal API Directly

```typescript
// Creating dates
Temporal.PlainDate.from({ year: 2025, month: 12, day: 15 })
Temporal.PlainDate.from("2025-12-15")

// Creating ZonedDateTime
Temporal.ZonedDateTime.from({ year, month, day, hour, minute, timeZone })

// Arithmetic - use .add() and .subtract()
date.add({ days: 5 })
date.subtract({ days: 3 })
zdt.add({ minutes: 30 })

// Duration between two ZonedDateTimes
end.since(start).total({ unit: "minutes" })

// Comparison
Temporal.ZonedDateTime.compare(a, b)  // -1, 0, or 1
date1.equals(date2)                    // boolean
```

### Project Utilities

```typescript
// Current time
getSystemTimeZone()           // "America/New_York"
todayPlainDate(timeZone?)     // PlainDate for today

// Day bounds (for range queries)
startOfDayZoned(date, timeZone)   // Start of day
endOfDayZoned(date, timeZone)     // Exclusive end (start of next day)
getDayBoundsZoned(date, timeZone) // { dayStart, dayEnd }

// Month operations
startOfMonth(date)            // First day of month
endOfMonth(date)              // Last day of month

// Comparison helpers
isToday(date, timeZone?)      // Is PlainDate today?
isSameDay(a, b)               // Same calendar day? (ZonedDateTime)

// Clamping
clampZonedDateTime(value, min, max)

// Calendar grid positioning
minutesFromMidnight(zdt)      // Minutes since midnight
```

### Native Date Interop (for UI boundaries)

```typescript
// Date ↔ PlainDate
dateToPlainDate(date, timeZone)
plainDateToDate(date, timeZone)

// Date ↔ ZonedDateTime
dateToZonedDateTime(date, timeZone)
zonedDateTimeToDate(zdt)

// Date ↔ String (for form fields with date pickers)
dateToDateString(date)        // Date → "2025-12-15" (local timezone)
dateStringToDate(str)         // "2025-12-15" → Date (local midnight)
```

### Parsing Database Strings

```typescript
// Parse Postgres timestamp (handles "2025-12-15 09:30:00" format with space)
isoStringToZonedDateTime(str, timeZone)

// For API output
zonedDateTimeToISOString(zdt)  // → "2025-12-15T14:30:00.000Z"
```

### Formatting

```typescript
formatPlainDate(date, options?)                   // "Dec 15, 2025"
formatTime(zdt, options?)                         // "9:30 AM"
formatHourLabel(hour)                             // "9 AM"
formatDateString(str, options?)                   // Format "YYYY-MM-DD" string
formatTimestampString(str, timeZone, options?)    // Format timestamp string
```

## Common Patterns

### Creating PlainDate/ZonedDateTime

```typescript
// From components - use Temporal.*.from() directly
const date = Temporal.PlainDate.from({ year, month, day });
const zdt = Temporal.ZonedDateTime.from({
  year: date.year,
  month: date.month,
  day: date.day,
  hour,
  minute,
  timeZone,
});
```

### Passing DateTime in Component Data

Instead of decomposing date/time into separate fields, pass the full `ZonedDateTime`:

```typescript
// ✓ Prefer: Single ZonedDateTime
type SlotData = { dateTime: Temporal.ZonedDateTime };

// ✗ Avoid: Decomposed fields that need reconstruction
type SlotData = { date: PlainDate; hour: number; minutes: number };
```

### Parsing task.startTime from DB

```typescript
const timeZone = useAtomValue(timezoneAtom);

// task.startTime is "2025-12-15 09:30:00" from Postgres
const startZdt = isoStringToZonedDateTime(task.startTime, timeZone);
const endZdt = startZdt.add({ minutes: task.durationMinutes });
```

### Duration calculations

```typescript
// Use Temporal's .since() directly
const durationMinutes = Math.round(end.since(start).total({ unit: "minutes" }));
```

### Building API payloads

```typescript
// Convert ZonedDateTime to ISO string for API
updateTask.mutate({
  id: task.id,
  task: { startTime: zdt.toInstant().toString() },
});
```

### Form with date picker

```typescript
// Form state stores YYYY-MM-DD string (matches DB schema)
const form = useForm({
  defaultValues: {
    dueDate: dateToDateString(new Date()), // "2025-12-15"
  },
});

// Convert for Calendar component (which expects native Date)
<Calendar
  selected={field.value ? dateStringToDate(field.value) : undefined}
  onSelect={(date) => field.onChange(date ? dateToDateString(date) : null)}
/>
```

## Gotchas

### Postgres Timestamp Storage

Postgres `timestamp` (without time zone) stores bare datetime values without timezone info:
- **Input**: `2025-12-15T14:00:00Z` → Postgres strips the `Z` and stores `2025-12-15 14:00:00`
- **Output**: Returns `2025-12-15 14:00:00` (no `Z`)

This means you must store **local datetime**, not UTC:

```typescript
// ✓ Correct: Store local datetime (preserves wall-clock time)
startTime: zdt.toPlainDateTime().toString()  // "2025-12-15T09:00:00"

// ✗ Wrong: toInstant converts to UTC, Postgres strips Z, time shifts
startTime: zdt.toInstant().toString()  // "2025-12-15T14:00:00Z" → stored as 14:00, read as 14:00 local
```

For APIs that expect UTC (like Google Calendar), use `.toInstant().toString()`.

### Postgres Timestamp Format

Postgres `TIMESTAMP` columns return `"2025-12-15 03:45:00"` (space, not `T`). Use `isoStringToZonedDateTime` which normalizes this and handles both formats.

### UTC vs Local

- `Temporal.Instant.from()` expects UTC (ends in `Z`)
- `Temporal.PlainDateTime.from()` parses as-is (no timezone)
- Our `isoStringToZonedDateTime` treats input as local time in the given timezone

### Date String Timezone Bugs

Never use `date.toISOString().split("T")[0]` - this converts to UTC first and can shift the date. Use `dateToDateString()` which preserves local timezone.

### PlainDate.equals() for Comparison

Use `.equals()` for PlainDate comparison, not `===`:

```typescript
// ✓ Correct
if (date1.equals(date2)) { ... }

// ✗ Wrong (compares object references)
if (date1 === date2) { ... }
```
