# Mobile Event Popover (Sheet)

Empty-slot creation starts with a chooser for an event or task; event create/edit uses `EventEditorSheet`.

## Where to find it

- Editor UI: `apps/native/components/calendar/calendar-event-editor-sheet.tsx`
- Calendar screen: `apps/native/app/(tabs)/(calendar)/index.tsx`
- Event session/mutation orchestration: `apps/native/hooks/use-event-editor-flow.ts`
- Controlled scope confirmation: `apps/native/components/calendar/event-scope-dialog.tsx`
- Draft types and session reducer: `packages/state/src/event-editor.ts`
- Recurrence field hydration: `apps/native/components/calendar/event-editor-form.ts`
- Shared recurrence logic: `packages/state/src/google-event-recurrence.ts`
- Shared recurrence scope options: `packages/state/src/recurrence-scope-options.ts`
- Shared picker primitives:
  - `apps/native/components/ui/date-picker.tsx`
  - `apps/native/components/ui/picker.tsx`

## Architecture and state

- Uses `react-hook-form` in `EventEditorSheet` for event form state; the form values are the `EventDraft` itself.
- Uses a single exported `EventEditorSheet` for create and edit, keyed by editor session ID. The form initializes once per session and remains mounted with its sheet throughout scope confirmation.
- The form owns live edits. A late recurring master only initializes the recurrence field if the user has not edited or touched it. It never resets the title, location, or expanded UI.
- One shared reducer owns `closed`, `editing`, `scope`, and `submitting` transitions. Drafts in this reducer are initial values or submission snapshots, not a second live form.
- Submissions carry a session ID and operation ID. Duplicate submits and stale completions are ignored. Save/delete are disabled during submission.
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
- If update succeeds and move fails, the confirmation retains the successful update and the returned event ID. `Retry move` only repeats the move. Closing that confirmation leaves the saved changes on the source calendar.

Edit (recurring):
- Save does not apply immediately.
- A scope card overlays the form inside the same native modal:
  - Only this occurrence
  - Entire series
  - This and following
- Confirming scope applies the update. If the calendar changes, only `all` is enabled and the entire series moves.
- Confirmation stays open while submitting and after failure. Failed saves/deletes retain their draft and selected scope for retry. `Back` returns to the same form with its edits intact.

Delete:
- Non-recurring: simple confirm dialog.
- Recurring: scoped delete dialog (`this`/`all`/`following`).

## Implementation constraints

- Keep the editor sheet and form mounted throughout scope confirmation. Render the controlled scope card as a modal overlay inside the sheet, with background touch and accessibility access blocked. Back removes the overlay directly; it does not wait for a native modal dismissal. Android Back cancels scope through the same guarded reducer action.
- Direct save failures keep the form open. Dismissing a direct save and opening a new editor prevents the earlier completion from closing the new session. Already-started writes still finish.
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
- Save is disabled during requests and closes the session only on success; failures retain edits.
- While an occurrence's master loads, type a title/location and edit or clear recurrence. Hydration preserves those edits and expanded sections.
- Start saving A, dismiss it, then open B. A's completion leaves B open.
- Fail a scoped save/delete, then retry. The draft and selected scope remain.
- Fail a move after a successful update. Retrying sends only the move.
- Recurring save opens a scope overlay; Back restores the same editable form and draft.
- Recurring delete opens scope prompt; non-recurring delete opens simple confirm.
- `following` updates succeed (no missing timezone error).
- Calendar picker shows color dots and same-account calendars only.
- Repeat editor opens under time row and stays collapsed until toggled.
