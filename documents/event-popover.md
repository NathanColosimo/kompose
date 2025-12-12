## Event Edit Popover

Inline editor for Google calendar events, mirrored after the task edit popover.

### Where to find it
- Component: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Triggered from: `GoogleCalendarEvent` (`apps/web/src/components/calendar/events/google-event.tsx`)
- Helper utilities: `apps/web/src/components/calendar/events/event-edit-utils.ts`
- Prefetch hook: `apps/web/src/hooks/use-recurring-event-master.ts`

### Fields
- Color picker (normalized Google event palette per account)
- Title, description, location
- All-day toggle (switches to date-only start/end; end is stored as next-day exclusive)
- Start/end date with shadcn calendar popovers
- Start/end time (15-minute step) when not all-day
- Recurrence editor (RRULE) behind a small **recurrence icon** button:
  - Frequency (none/daily/weekly/monthly)
  - Weekly weekday selection (BYDAY)
  - End options (no end, UNTIL date, or COUNT)
- Move button (**Move…**) which opens a separate move dialog

### Behavior
- Uses React Hook Form.
- **Saves only if the user edited something**:
  - Opening then closing without edits does not call `events.update`.
  - “Edited” means any interaction (even if you change a value and change it back).
- **Save timing**: changes are saved on popover close.

#### Recurring scope selection (post-close)
- Recurrence scope is no longer selected inline in the main popover.
- If the event is recurring *and* the user edited it, closing the popover shows a **scope dialog** (shadcn `RadioGroup`) with:
  - Only this occurrence
  - Entire series
  - This and following

#### Recurrence master hydration + prefetch
- Recurring instances often do not include the RRULE on the instance.
- The series master is fetched via `useRecurringEventMaster` and is:
  - **Prefetched in the background** from `GoogleCalendarEvent` (non-blocking render)
  - Reused in the popover to hydrate the recurrence editor

#### Move to calendar flow
- Moving between calendars is handled via a separate **Move…** flow (not as part of the normal edit save).
- If there are unsaved edits and the user clicks **Move…**, it performs **save-then-move**.
- Move supports recurrence scopes:
  - `this`: move the instance/event
  - `all`: move the series master
  - `following`: truncate the original master series and create a new series in the destination calendar
- For non-recurring events, move scope is effectively limited to `this`.

#### Backend safety: partial failure recovery for `following`
- For `following` (both update and move), if the master is truncated but the new series creation fails,
  the client attempts a **best-effort rollback** by restoring the master’s original recurrence.

#### Error feedback
- Mutations surface failures via toast errors:
  - `useUpdateGoogleEventMutation`
  - `useMoveGoogleEventMutation`

### Manual test checklist
- Open popover and close without edits: no network update.
- Edit title/time on a non-recurring event; close: saves once.
- Recurring event edit; close: scope dialog appears; each scope behaves correctly.
- Recurrence editor: set Frequency to **None**; RRULE is cleared.
- Recurrence editor: weekly BYDAY changes persist; UNTIL/COUNT modes work.
- Prefetch: opening a recurring instance’s popover should not “wait” for recurrence to appear.
- Move…:
  - With unsaved edits: save first, then move.
  - Scope `this`/`all`/`following` works; `following` does split + new series.
