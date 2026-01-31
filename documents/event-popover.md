## Event Edit Popover

Unified inline editor for Google calendar events. Supports both **create** and **edit** modes.

### Where to find it
- Component: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Triggered from (edit mode): `GoogleCalendarEvent` (`apps/web/src/components/calendar/events/google-event.tsx`)
- Triggered from (create mode): `EventCreationPopover` (`apps/web/src/components/calendar/event-creation/event-creation-popover.tsx`)
- Helper utilities: `apps/web/src/components/calendar/events/event-edit-utils.ts`
- Prefetch hook: `apps/web/src/hooks/use-recurring-event-master.ts`
- Mutations: `apps/web/src/hooks/use-google-event-mutations.ts`

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

### Fields
- Color picker (normalized Google event palette per account)
- Title (auto-focuses in create mode, shows "(required)" placeholder)
- Description
- Location
- All-day toggle (checkbox-style button with checkmark indicator)
- Start/end date with shadcn calendar popovers
- Start/end time (15-minute step) when not all-day
- Recurrence editor (RRULE) behind a small **recurrence icon** button:
  - Frequency (none/daily/weekly/monthly)
  - Weekly weekday selection (BYDAY)
  - End options (no end, UNTIL date, or COUNT)
- Move button (**Move…**) — only in edit mode for recurring events
- Delete button — only in edit mode

### Create Mode

Used for click-and-drag event creation on the calendar.

#### Differences from Edit Mode
- **Title is required**: Event is only saved if a non-empty title is provided
- **Recurrence editor always available**: Can create recurring events from the start
- **No delete button**: Nothing to delete yet
- **No move button**: Not applicable for new events
- **Auto-focus on title**: Input focuses immediately for quick entry
- Uses `createEvent` mutation instead of `updateEvent`

#### Click-and-Drag Creation Flow
1. User hovers over calendar → 30-minute preview appears
2. User clicks and drags → preview expands to selected time range
3. User releases mouse → popover opens in create mode
4. User enters title (required) and optional details
5. User clicks away or presses Escape → event is created (if title provided) or discarded

#### Components
- `EventCreationProvider` — Context provider for creation state
- `useEventCreation` — Hook for managing creation state and actions
- `CreationPreview` — Visual preview during hover/drag
- `EventCreationPopover` — Renders `EventEditPopover` in create mode

### Behavior
- Uses React Hook Form.
- **Edit mode saves only if the user edited something**:
  - Opening then closing without edits does not call `events.update`.
  - "Edited" means any interaction (even if you change a value and change it back).
- **Create mode saves only if title is provided**.
- **Save timing**: changes are saved on popover close.

#### Recurring scope selection (post-close) — Edit Mode Only
- Recurrence scope is no longer selected inline in the main popover.
- If the event is recurring *and* the user edited it, closing the popover shows a **scope dialog** (shadcn `RadioGroup`) with:
  - Only this occurrence
  - Entire series
  - This and following

#### Recurrence master hydration + prefetch — Edit Mode Only
- Recurring instances often do not include the RRULE on the instance.
- The series master is fetched via `useRecurringEventMaster` and is:
  - **Prefetched in the background** from `GoogleCalendarEvent` (non-blocking render)
  - Reused in the popover to hydrate the recurrence editor
- In create mode, the hook is disabled (no event to query).

#### Move to calendar flow — Edit Mode Only
- Moving between calendars is handled via a separate **Move…** flow (not as part of the normal edit save).
- If there are unsaved edits and the user clicks **Move…**, it performs **save-then-move**.
- Move supports recurrence scopes:
  - `this`: move the instance/event
  - `all`: move the series master
  - `following`: truncate the original master series and create a new series in the destination calendar
- For non-recurring events, move scope is effectively limited to `this`.

#### Backend safety: partial failure recovery for `following`
- For `following` (both update and move), if the master is truncated but the new series creation fails,
  the client attempts a **best-effort rollback** by restoring the master's original recurrence.

#### Error feedback
- Mutations surface failures via toast errors:
  - `createEvent` (create mode)
  - `updateEvent` (edit mode)
  - `moveEvent` (move flow)

### Manual test checklist

#### Edit Mode
- Open popover and close without edits: no network update.
- Edit title/time on a non-recurring event; close: saves once.
- Recurring event edit; close: scope dialog appears; each scope behaves correctly.
- Recurrence editor: set Frequency to **None**; RRULE is cleared.
- Recurrence editor: weekly BYDAY changes persist; UNTIL/COUNT modes work.
- Prefetch: opening a recurring instance's popover should not "wait" for recurrence to appear.
- Move…:
  - With unsaved edits: save first, then move.
  - Scope `this`/`all`/`following` works; `following` does split + new series.
- Delete: confirmation dialog for non-recurring; scope dialog for recurring.

#### Create Mode
- Hover on calendar: 30-minute preview appears.
- Click and drag: preview expands to match selected time range.
- Release: popover opens with title focused.
- Close without title: no event created.
- Enter title and close: event created with correct time range.
- Set recurrence before saving: event created with RRULE.
- All-day toggle: creates all-day event with correct date range.
