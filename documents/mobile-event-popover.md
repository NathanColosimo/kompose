# Mobile Event Popover (Sheet)

Empty-slot creation starts with a chooser for an event or task; event create/edit uses `EventEditorSheet`.

## Where to find it

- Editor UI: `apps/native/components/calendar/calendar-event-editor-sheet.tsx`
- Calendar screen orchestration + scope dialogs: `apps/native/app/(tabs)/(calendar)/index.tsx`
- Draft/event types: `apps/native/components/calendar/calendar-editor-types.ts`
- Shared recurrence logic: `packages/state/src/google-event-recurrence.ts`
- Shared recurrence scope options: `packages/state/src/recurrence-scope-options.ts`
- Shared picker primitives:
  - `apps/native/components/ui/date-picker.tsx`
  - `apps/native/components/ui/picker.tsx`

## Architecture and state

- Uses `react-hook-form` in `EventEditorSheet` for event form state; the form values are the `EventDraft` itself.
- Uses a single exported `EventEditorSheet` for create and edit. The calendar mounts it only while a draft is open.
- Uses the existing `TaskEditorSheet` in `mode="create"` for task creation from the calendar tab.
- Event-specific recurrence parsing/building and default scope logic are centralized in `@kompose/state`.

## Form layout (matches current mobile UX)

Top-to-bottom:

1. Title row
- Color picker dot at left (web-style)
- Title input to the right: the most-edited field, and on create the first thing typed

2. Schedule: two rows, starts then ends, so a 12-hour time never has to shrink
- Start date and start time (time hidden for all-day)
- End date and end time
- Moving the start keeps the event's length. "Ends before it starts." shows under the rows while the end is before the start, and Save stays off.

3. Repeat row (its own full-width row)
- Says how the event repeats, in words ("Repeats weekly on Tue"), with "· Tokyo time" when the series' zone isn't the app's
- Tapping it opens the repeat editor under it: frequency chips, the interval stepper, weekday chips (weekly), the monthly day choice, and the end (never / on date / after N)
- For an occurrence it shows the series' rule, which can load after the editor opens ("Loading repeat…"); if the load fails, "The repeat didn't load." (or "didn't refresh.") sits beside a Try again button
- It shows the rule the save sends (`seriesRepeatForEdit`): an occurrence moved to another day shows the series' rule following that day, and a rescheduled occurrence left where it is counts from its place in the series

4. All-day + meeting row
- All-day switch in a pill-shaped container
- Meeting action on same row (`Add Meet` / `Join ...` / `Meet on save`); at large text sizes the two stack

5. Location row
- Location input
- Maps button when a location exists
- Inline location suggestions from Maps search

6. Description

7. Calendar picker
- Shows current calendar
- Shows calendar color dots in trigger and options
- Edit mode options are limited to calendars under the same Google account as the source event

Locked, Gmail, and birthday events, and those on a calendar the user can only view, open as a read-only view instead: why it can't be edited, then the time, repeat, calendar, a Join button, the place (opens Maps), and the notes.

## Header actions

- Save is a check icon in header-right; while the save runs it reads "Saving…".
- Delete is a red trash icon in header-right (edit mode only).
- There is no separate `Move...` button; changing the calendar picker handles move.

## Save/delete behavior

Create:
- Empty-slot tap opens a chooser with `New event` and `New task`.
- `New event` opens the existing event sheet and saves directly via `createEvent`.
- `New task` opens the task sheet in create mode and saves via `createTask`.
- Task creation is prefilled from the tapped slot:
  - `startDate`
  - `startTime`
  - `durationMinutes` (currently 30 minutes)

Edit (non-recurring):
- Saves directly via `updateEvent`.
- If calendar changed, then runs `moveEvent` with scope `this`.

Edit (recurring):
- Save opens the scope dialog over the editor, which stays open: Cancel goes back to it with the edits; Apply holds "Saving…" until the save ends, and a failure leaves the editor with the edits.
  - Only this occurrence
  - This and following
  - Entire series
- A scope that can't apply is off, and the dialog's line says why (a moved day, the series still loading, a repeat that would skip this occurrence; see [event-popover.md](./event-popover.md)). If the calendar changes, only `all` is enabled and the entire series moves.
- A save for the series (`following`/`all`) sends only its times, its repeat, and the fields the user changed against the occurrence the editor opened with (`seriesEditFields` in `packages/state/src/series-edit.ts`), so the series keeps its own title, place, notes and color; times the user left alone go as the occurrence's own, and the server keeps the series' slot for them.
- Entire series is off, with the reason in the dialog, when a new repeat would cancel a meeting the user moved (`movedMeetingDropped`, among the series' loaded occurrences), or when a new time can't apply to a series of several rules. If the server refuses a save, the app shows its words. When it refuses an Entire series save because a new repeat would drop a moved meeting, the dialog stays open with Entire series off and names that meeting by the day the calendar shows it on (or its original day when it isn't loaded); any other refusal returns to the editor with the edits.

Delete:
- Non-recurring: simple confirm dialog.
- Recurring: scoped delete dialog (`this`/`all`/`following`), over the editor; Cancel goes back to it.

## Implementation constraints

- Scope and delete dialogs render inside the editor sheet (its `overlay`): iOS presents a modal only from the one showing.
- Timed updates include `start.timeZone` and `end.timeZone`.
- Update payload preserves nested `start`/`end` fields from the source event when merging.
- Picker triggers in event editor hide leading icons (`showIcon={false}`).
- Compact date labels use `Mon D` format (year hidden in display label).
- Year list auto-scrolls to selected year.
- Time lists auto-scroll to the selected hour/minute.

## Quick QA checklist

- Empty-slot tap opens the create chooser instead of jumping straight into the event sheet.
- Choosing `New event` still opens the event sheet with the tapped time prefilled.
- Choosing `New task` opens the task sheet with the tapped date/time and a 30-minute duration.
- Saving the new task creates a scheduled task block in the calendar.
- Save icon holds "Saving…", then closes the editor once the change is in.
- Recurring save opens the scope prompt over the editor; Cancel returns to the edits.
- Moving an occurrence to another day: the Repeat row follows the new day, and Entire series is off with the reason.
- This and following from a rescheduled occurrence with its own title keeps the series' title and time for the later meetings.
- Recurring delete opens scope prompt; non-recurring delete opens simple confirm.
- `following` updates succeed (no missing timezone error).
- Calendar picker shows color dots and same-account calendars only.
- Repeat editor opens under the Repeat row and stays collapsed until toggled.
