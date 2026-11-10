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
- Event recurrence parsing/building and scope choices are shared through `@kompose/state`. The editor preserves rule parts it cannot show and marks them custom. Moving a start does not rewrite its rule.

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
- Says how the event repeats, in words ("Repeats weekly on Tue")
- Tapping it opens the repeat editor under it: frequency chips, the interval stepper, weekday chips with a Weekdays shortcut for Monday to Friday (weekly), the monthly day choice, and the end (never / on date / after N, up to 730 as in Google Calendar)
- For an occurrence it shows the series' rule, which can load after the editor opens ("Loading repeat…"); if the load fails, "The repeat didn't load." (or "didn't refresh.") sits beside a Try again button

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

- Empty-slot tap offers New event or New task, prefilled from the tapped slot.
- Save keeps the sheet open with Saving… and read-only fields until the write finishes. Dismissal and a second submit wait. A failure keeps the draft and shows a message below the header; Save retries it.
- Non-recurring edits save directly. A calendar change saves the edits and then moves the event. If that move fails after the edits save, the message says so.
- Recurring edits open the scope dialog over the sheet. Cancel returns to the draft. The choices are Only this occurrence, This and following, and Entire series. A new calendar applies to the entire series: Google moves a series to another calendar only as a whole.
- The dialog waits for the series to load. A changed repeat disables Only this occurrence. A move to another day disables Entire series, which keeps the series’ date.
- Series saves send only changed details, with edited times directly. Unchanged occurrence titles, guests, and other details stay out of the series payload.
- The repeat editor parses and builds its primary rule and keeps unsupported parts and other recurrence lines. Explicitly picked end dates are encoded for the event’s form. Start moves do not rewrite weekdays, month days, UNTIL, COUNT, or exception dates.
- Entire series applies edited times to the series’ first event, keeping its date. This and following ends the old series and creates a new one. The UI does not inspect other occurrences or handle typed refusals.
- Recurring delete offers all three scopes. Non-recurring delete asks for confirmation. Deleting… holds the dialog; a failure stays there with retry available.

## Implementation constraints

- Mount the event sheet only while a draft is open; keep scope and delete dialogs inside its modal overlay.
- Timed updates include `start.timeZone` and `end.timeZone`.
- `draftTimes` preserves an unchanged instant during a repeated DST hour and sends one date form per endpoint.
- Picker triggers hide leading icons. Compact date labels omit the year; date and time lists scroll to the selected values.

## Quick QA checklist

- Empty-slot tap opens the create chooser instead of jumping straight into the event sheet.
- Choosing `New event` still opens the event sheet with the tapped time prefilled.
- Choosing `New task` opens the task sheet with the tapped date/time and a 30-minute duration.
- Saving the new task creates a scheduled task block in the calendar.
- Save icon holds "Saving…", then closes the editor once the change is in.
- Recurring save opens the scope prompt over the editor; Cancel returns to the edits.
- Moving an occurrence to another day keeps the repeat rule unchanged; Entire series is off with the reason.
- A series save leaves an occurrence’s unchanged title and guests out of the payload and sends its edited times directly.
- Recurring delete opens scope prompt with every scope on; non-recurring delete opens simple confirm.
- A delete that fails (offline, say) keeps its dialog open with "Couldn't delete it. Try again."
- `following` updates succeed (no missing timezone error).
- Calendar picker shows color dots and same-account calendars only.
- Repeat editor opens under the Repeat row and stays collapsed until toggled.
