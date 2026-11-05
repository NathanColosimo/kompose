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

1. Compact schedule row (single row)
- Start date picker (small)
- Start time picker (small, hidden for all-day)
- End date picker (small)
- End time picker (small, hidden for all-day)
- Repeat icon toggle button at row end

2. Recurrence editor (collapsed by default)
- Opened via repeat icon
- Rendered directly under the schedule row (not at the bottom)
- Frequency: none/daily/weekly/monthly
- Weekly BYDAY chips
- End mode: never/date/count

3. Title row
- Color picker dot at left (web-style)
- Title input to the right

4. All-day + meeting row
- All-day switch in a pill-shaped container
- Meeting action on same row (`Add Meet` / `Join ...` / `Meet on save`)

5. Location row
- Location input
- Maps button when a location exists
- Inline location suggestions from Maps search

6. Description

7. Calendar picker
- Shows current calendar
- Shows calendar color dots in trigger and options
- Edit mode options are limited to calendars under the same Google account as the source event

## Header actions

- Save is a green check icon in header-right.
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
- Save does not apply immediately.
- Sheet closes first, then scope dialog opens:
  - Only this occurrence
  - Entire series
  - This and following
- Confirming scope applies the update. If the calendar changes, only `all` is enabled and the entire series moves.

Delete:
- Non-recurring: simple confirm dialog.
- Recurring: scoped delete dialog (`this`/`all`/`following`).

## Implementation constraints

- Close the editor (`setEventDraft(null)`) before showing a scope dialog to prevent background interaction lock.
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
- Save icon closes editor and applies changes.
- Recurring save opens scope prompt after editor closes.
- Recurring delete opens scope prompt; non-recurring delete opens simple confirm.
- `following` updates succeed (no missing timezone error).
- Calendar picker shows color dots and same-account calendars only.
- Repeat editor opens under time row and stays collapsed until toggled.
