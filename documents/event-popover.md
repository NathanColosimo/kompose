## Event Edit Popover

Unified inline editor for Google calendar events. Supports both **create** and **edit** modes.

### Where to find it
- Component: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Triggered from (edit mode): `GoogleCalendarEvent` (`apps/web/src/components/calendar/events/google-event.tsx`)
- Triggered from (create mode): `EventCreationPopover` (`apps/web/src/components/calendar/event-creation/event-creation-popover.tsx`)
- Helper utilities: `apps/web/src/components/calendar/events/event-edit-utils.ts`
- Recurrence master hook: `packages/state/src/hooks/use-recurring-event-master.ts`
- Mutations: `packages/state/src/hooks/use-google-event-mutations.ts` and `packages/state/src/hooks/use-move-google-event-mutation.ts`

### Props
- `event?: GoogleEvent` — The event to edit. Optional for create mode.
- `accountId: string` — Google account ID
- `calendarId: string` — Calendar ID
- `start: Date` — Start time
- `end: Date` — End time
- `mode?: "create" | "edit"` — Explicit mode (auto-detected from event presence if not provided)
- `open?: boolean` — Controlled open state
- `onOpenChange?: (open: boolean) => void` — Controlled open state callback
- `side`, `align` — Popover positioning

### Field order
1. Color picker + Title row (auto-focuses in create mode)
2. Description
3. Separator
4. All-day toggle + Recurrence icon + Calendar picker (single row, calendar dropdown pushed right with color dot indicator)
5. Start/end date (2-column grid)
6. Start/end time (2-column grid, hidden when all-day)
7. Meeting section (join link / add Google Meet)
8. Location (combobox with Google Places search)
9. Separator
10. **Action row** (edit mode): `[Delete] ... [Cancel] [Save]` in a single row.

### Save / Cancel behavior
- Explicit **Save** / **Cancel** buttons at the bottom of the form (edit mode).
- **Save**: builds a close-save request from the form, then processes mutations (update, move, create).
  - The editor stays open ("Saving…", fields read-only) until the save succeeds. A failure keeps it open with the edits and a toast ("Couldn't save your changes. They're still here.").
  - A recurring event asks for the scope in a dialog over the editor. Cancel goes back to the editor with the edits; Save there holds the editor the same way.
  - A form that ends before it starts can't be saved by any path (Save, Cmd+Enter, Add Google Meet, the create popover's Save): the request is `invalid`, and the form shows "Ends before it starts."
  - The repeat is sent only when the user changed it with the Repeat control. An occurrence's pattern lives on its master, which can load after the editor opens.
- **Cancel**, **Escape**, or **click-outside**: discard unsaved changes and close without saving (not while a save runs).

### Repeat editor (web and iOS)
- Rules are read and built with `packages/state/src/google-event-recurrence.ts`, shared by both editors; the words and the monthly choices are in `packages/state/src/event-recurrence-words.ts`. The editors set frequency, interval, BYDAY, BYMONTHDAY and the end; every other part of a rule (WKST, BYMONTH...) is kept.
- Picking a frequency (`pickRecurrenceFrequency`): the same one changes nothing. A new one starts at every 1, drops the old frequency's day parts, and keeps only plain weekdays for Weekly ("2TU" isn't valid weekly).
- Monthly offers the start's day of the month ("Day 27"), its weekday of the month ("The 4th Fri"), and in its last week the last one ("The last Fri"). A rule set another way ("The last weekday", "Day 15") comes first, selected, so opening the editor never changes it. A weekday of the month replaces BYMONTHDAY; BYSETPOS goes with the BYDAY it picks from.
- "On date" ends after that day's occurrence: UNTIL is the date for an all-day series and the day's last second, in the app's time zone, for a timed one. It starts three months after the series' start; earlier dates can't be picked.
- An occurrence's save for the series sends a rule only when it moves the day (the rule follows it); otherwise the server lines the series' own rule, freshly read, up with the new time or form, so a copy cached on the client can't write an old rule back. The client's copy of a series counts as ready only once loaded and not being fetched again after a write (pending, paused offline, or failed). Moving a series' start carries its days with it (`followStart`), and its skipped occurrences too (`moveSkippedDays`): a skip moves in its own period as the pattern did (by the move's shift within the week or INTERVAL, or only by the weeks when a weekly rule kept its days; to the new rule's day nearest its time in a month or year, either way, the move counted in months and days so February doesn't throw it off), never onto the moved meeting or a day the old pattern met on; a skip the new pattern still has is a date and stays; and the day the start moves to is never left skipped (in a series several times a day, only its start's time; rules at different hours count as several a day, so their times and skipped times stay their own; a part a rule leaves out is the series' start's, so BYHOUR=9 and BYHOUR=9;BYMINUTE=0 are one time; in such a series only the moved rule's skipped times move, another rule's stay, a skip another rule still needs stays, one never lands on another rule's meeting, and a time part the moved rule leaves out follows the new start, for its skips that stay on their day too, and on a time-only edit; an hourly rule's times stay its own). An added (RDATE) meeting's skip keeps its time, and no skip moves onto an added meeting. Made all day, a series loses its rule times; a cancelled added meeting goes from both lists, and a timed skip becomes its date only when every meeting that day was skipped (rules counted from where they start, COUNT meeting by meeting from the series' first day, UNTIL to its moment); a COUNT over several times a day becomes the days they fell on. A rule the editor can't write (hourly, say) is kept as it is when the start's day moves. A weekly rule with several days keeps its set when the new start is already one of them: a weekly series' start weekday, the start's day or weekday of the month ("2nd Tue" to "3rd Wed"; `BYDAY=SA;BYSETPOS=1` too; a last stays a last when the new day is in its month's last week, and otherwise becomes the new day's weekday of the month, so the series still lands on the day picked), a yearly series' month; an end date the start passed moves three months on.
  - Editing the series itself (or a new one), it applies as the start moves.
  - Moving an occurrence to another day offers "Only this occurrence" (a reschedule; the series keeps its rule) or "This and following" (a new series from the moved day, its rule following that day: `seriesRecurrenceForSave`), as Google's editor does. "Entire series" is off for a moved day, since the series keeps its first date, and "This and following" waits until the series' rule has loaded (`eventSaveDisabledScopes`).
  - "Entire series" through an occurrence keeps the series' first day and takes the edit's form, wall-clock time and length in the event's zone (`seriesTimesForEdit` in packages/google-cal), so a series begun before a DST change keeps its hour and an occurrence made all day makes the series all day. An edit to the series itself or its first occurrence moves its date.
- A series' days (its end day, a moved start's weekday) are counted, and its edits written, in its own time zone (`eventTimeZone`; the server prefers the series' zone too), since Google repeats a series in its start's zone: a Tokyo meeting edited from New York stays on Tokyo's days. When that zone isn't the app's, the repeat editor's days and choices are the series' (a Tokyo Tuesday 9:00 shown Monday evening in New York repeats on Tuesday) and it says "· Tokyo time"; the scope dialog names it too ("A new day in Tokyo time…"). If the series' rule fails to load, it says the new day applies to this occurrence only.
- A series' UNTIL and EXDATE/RDATE values always take the start's form when sent, on both apps and the server (`matchRecurrenceToStart` in packages/google-cal/src/until.ts): dates for an all-day series, date-times for a timed one (a skipped occurrence stays skipped), so toggling All day stays valid. Skipped days are read on the series' days (in its zone) and move with its start time. "This and following" starts a new series, so it's offered only at one of the rule's own meetings in a series with one rule: not at an added (RDATE) meeting (one past the rule's own end counts as added), nor in a series with several rules (only imported calendars write them), where a new start would shift the other meetings' days or phase. The scope dialog says why (`seriesSplitBlock`) and the server refuses it too (`followingSplitBlocked`). The dialog keeps This and following off until the series loads, says why when it's off, and turns Save off while the chosen scope is. Splitting a series ends the old part (never later than the rule's own end) the day before (a date) or the second before (a date-time), gives each part its own RDATE days, and carries on an unchanged COUNT with exactly the rule positions left, each counted rule on its own at its own time (one with none of its own left is dropped wherever it's listed; if none would be left, the first ends at the new part's start): a rule with the parts the editors and most calendars write (incl. BYDAY with BYMONTHDAY as an intersection, BYSETPOS monthly or weekly, a single BYHOUR/BYMINUTE) is walked from its start (packages/google-cal/src/rule-days.ts), skipped days counting and added ones not; for a rule with other parts the server counts from Google's list, and a series with added days there has its new part end where the old rule did. On the server the final rule is always lined up with the series' own start, in its zone, whatever a client sent.
- The rule shows in words ("Repeats every 2 months on the 2nd Tue"); parts the words don't cover add "(custom)", so nothing is hidden.
- When `EventEditForm` is used inside `EventCreationPopover`, `onCancel` is not passed, so the form does not show its own action buttons — the creation popover header provides Save/Cancel instead.

### Create Mode

Used for click-and-drag creation on the calendar.

#### Create-type toggle
- The creation popover shows `Event` / `Task` tabs alongside `Cancel` / `Save` buttons in a single header row.
- `Event` is the default on the first open.
- After that, the popover reopens on whichever create type the user last selected.
- The `Task` tab reuses the full inline task form, including due date, recurrence, links, and tags.
- Switching tabs preserves:
  - title (`summary` <-> `title`)
  - description
  - start date / start time
  - duration (`event end - start` <-> `task durationMinutes`)
- Switching tabs resets non-shared fields back to the target form defaults.
  - Event-only fields reset: calendar-specific details like location, color, recurrence, all-day, and meeting state
  - Task-only fields reset: tags, links, due date, and recurrence

#### Differences from Edit Mode
- **Title is required**: Event is only saved if a non-empty title is provided
- **Recurrence editor always available**: Can create recurring events from the start
- **No delete button**: Nothing to delete yet
- **No move button**: Not applicable for new events
- **Auto-focus on title**: Input focuses immediately for quick entry
- Uses `createEvent` mutation instead of `updateEvent`

#### Keyboard shortcuts (Create Mode)

See [hotkeys.md](./hotkeys.md#creation-forms) for the save shortcut.

#### Click-and-Drag Creation Flow
1. User hovers over calendar → 30-minute preview appears
2. User clicks and drags → preview expands to selected time range
3. User releases mouse → popover opens in create mode
4. User keeps the default `Event` tab or switches to `Task`
5. User enters title (required) and optional details
6. User clicks **Save** (or Cmd/Ctrl+Enter) to create the event/task, or **Cancel** / Escape to discard

#### Components
- `DaysView` — Holds creation state (`useEventCreationState`) and provides `EventCreationContext`
- `useEventCreation` — Reads creation state and actions from that context
- `CreationPreview` — Visual preview during hover/drag
- `EventCreationPopover` — Renders the shared create popover with `Event` / `Task` tabs and Save/Cancel buttons

### Edit Mode Behavior
- Uses React Hook Form.
- **Save** only submits if the user edited something.
- Opening then closing without edits (via Cancel/Escape) does not call `events.update`.
- "Edited" means any interaction (even if you change a value and change it back).

#### Recurring scope selection (post-close) — Edit Mode Only
- Recurrence scope is no longer selected inline in the main popover.
- If the event is recurring *and* the user clicks Save, a **scope dialog** (shadcn `RadioGroup`) appears with:
  - Only this occurrence
  - Entire series
  - This and following

#### Recurrence master hydration + prefetch — Edit Mode Only
- Recurring instances often do not include the RRULE on the instance.
- The series master is fetched via `useRecurringEventMaster` and is:
  - **Fetched lazily when the edit popover opens**
  - Reused in the popover to hydrate the recurrence editor
- In create mode, the hook is disabled (no event to query).

#### Move to calendar flow — Edit Mode Only
- Moving between calendars is handled via the calendar picker in the form.
- If the user changes the calendar and clicks **Save**, the save flow handles both the data update and the calendar move.
- Recurring moves select `all` and disable `this` / `following` in the scope dialog. The series master is moved.
- Non-recurring moves use `this`.

#### Backend safety: partial failure recovery for `following`
- `GoogleCalendar` in `packages/google-cal/src/client.ts` implements `following` updates and moves. If the master is truncated but creating the replacement series fails, it attempts a best-effort rollback of the master's recurrence. This runs on the server; the edit UI only offers `following` for updates.

#### Error feedback
- Mutations surface failures via toast errors:
  - `createEvent` (create mode)
  - `updateEvent` (edit mode)
  - `moveEvent` (move flow)

### Manual test checklist

#### Edit Mode
- Open popover and Cancel/Escape: no network update.
- Edit title/time on a non-recurring event; click Save: saves once.
- Recurring event edit; click Save: scope dialog appears; each scope behaves correctly.
- Recurrence editor: set Frequency to **None**; RRULE is cleared.
- Recurrence editor: weekly BYDAY changes persist; UNTIL/COUNT modes work.
- Recurrence editor: "every 2 weeks" and monthly "The 2nd Tue" save; an end date includes that day's occurrence; re-picking the current frequency changes nothing.
- Click-outside: discards changes (no save).
- Delete: confirmation dialog for non-recurring; scope dialog for recurring.

#### Create Mode
- Hover on calendar: 30-minute preview appears.
- Click and drag: preview expands to match selected time range.
- Release: popover opens on the last selected create type (`Event` on first use).
- Switch to `Task`: title/description/start/duration carry over; other task fields start fresh.
- Cancel without title: no event created.
- Enter title and click Save: event created with correct time range.
- Switch to `Task`, enter title, click Save: scheduled task created with correct date/time and duration.
- Set recurrence before saving: event created with RRULE.
- All-day toggle: creates all-day event with correct date range.
- Escape: discards and closes without creating.
