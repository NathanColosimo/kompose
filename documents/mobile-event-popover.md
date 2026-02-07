# Mobile Event Popover (Sheet)

Mobile uses a bottom-sheet event editor that mirrors web behavior for create/edit, recurring scope prompts, calendar move behavior, and recurrence controls.

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

- Uses `react-hook-form` in `EventEditorSheet` for event form state.
- Uses a single `EventEditorSheet` for create/edit with thin wrappers:
  - `CreateEventEditorSheet`
  - `EditEventEditorSheet`
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
- Saves directly via `createEvent`.

Edit (non-recurring):
- Saves directly via `updateEvent`.
- If calendar changed, then runs `moveEvent` with scope `this`.

Edit (recurring):
- Save does not apply immediately.
- Sheet closes first, then scope dialog opens:
  - Only this occurrence
  - Entire series
  - This and following
- Confirming scope applies update and optional move with the selected scope.

Delete:
- Non-recurring: simple confirm dialog.
- Recurring: scoped delete dialog (`this`/`all`/`following`).

## Important fixes included

1. Recurrence scope dialog flow and lock-up
- The editor sheet is closed before showing scope dialogs (`setEventDraft(null)`), preventing background interaction lock.

2. `following` backend 400 fix (Google API timezone requirement)
- Timed updates include `start.timeZone` and `end.timeZone`.
- Update payload preserves nested `start`/`end` fields from the source event when merging.

3. Date/time picker UX
- Picker triggers in event editor hide leading icons (`showIcon={false}`).
- Compact date labels use `Mon D` format (year hidden in display label).
- Year list auto-scrolls to selected year.
- Time lists auto-scroll to the selected hour/minute.

## Shared-state extraction summary

To keep web/native aligned and avoid duplication, recurrence and scope logic lives in `packages/state`:

- `google-event-recurrence.ts`
- `recurrence-scope-options.ts`

This is what both platforms now consume for parsing/building recurrence and scope labels/defaults.

## Quick QA checklist

- Save icon closes editor and applies changes.
- Recurring save opens scope prompt after editor closes.
- Recurring delete opens scope prompt; non-recurring delete opens simple confirm.
- `following` updates succeed (no missing timezone error).
- Calendar picker shows color dots and same-account calendars only.
- Repeat editor opens under time row and stays collapsed until toggled.
