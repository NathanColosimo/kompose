## Event Edit Popover

Inline editor for Google calendar events, mirrored after the task edit popover.

### Where to find it
- Component: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Triggered from: `GoogleCalendarEvent` (`apps/web/src/components/calendar/events/google-event.tsx`)

### Fields
- Calendar picker (account + calendar list from loaded calendars)
- Color picker (normalized Google event palette per account)
- Title, description, location
- All-day toggle (switches to date-only start/end; end is stored as next-day exclusive)
- Start/end date with shadcn calendar popovers
- Start/end time (15-minute step) when not all-day
- Recurrence scope buttons: this occurrence / entire series / this & following
- Recurrence editor (RRULE): frequency (daily/weekly/monthly), weekday selection (BYDAY), end options (no end, UNTIL date, or COUNT)

### Behavior
- Uses React Hook Form; saves once when the popover closes.
- Scope handling:
  - This occurrence: updates the instance.
  - Entire series: targets the series master when `recurringEventId` exists.
  - This & following: truncates the original series with `UNTIL` and creates a new series starting at the edited occurrence.
- Calendar changes perform a Google `events.move` then update the event.
- Recurrence parsing/persistence:
  - Parses RRULE with FREQ, BYDAY, and end options (UNTIL or COUNT). Default end is “no end.”
  - For instances (no recurrence on the instance), the master recurrence is fetched and hydrated into the editor.
  - “All” and “Following” preserve recurrence arrays; instance-only fields are stripped before updating the series master.
  - “All” keeps the master date but applies the edited time (duration preserved, respects offsets/day-crossing).

### Manual test checklist
- Edit time only on a single event; close popover; event moves.
- Toggle all-day; dates save as expected (end exclusive).
- Change calendar; event moves to the new calendar after save.
- Pick a color; block updates to the chosen color.
- Recurring event: edit “this occurrence” vs “entire series” vs “this & following” and verify scope.
- Recurrence end modes: set None, UNTIL, COUNT; ensure RRULE reflects choice and instances remain intact.
- Weekly BYDAY changes: adjust weekdays and confirm series updates without losing UNTIL/COUNT.
