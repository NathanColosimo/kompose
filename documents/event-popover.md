## Event Edit Popover

Unified inline editor for Google calendar events. Supports both **create** and **edit** modes.

### Where to find it
- Component: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Triggered from (edit mode): `GoogleCalendarEvent` (`apps/web/src/components/calendar/events/google-event.tsx`)
- Triggered from (create mode): `EventCreationPopover` (`apps/web/src/components/calendar/event-creation/event-creation-popover.tsx`)
- Helper utilities: `apps/web/src/components/calendar/events/event-edit-utils.ts`
- Recurrence draft resolver: `packages/state/src/event-recurrence-draft.ts`
- Save/delete operation reducer and runner: `packages/state/src/event-edit-operation.ts`
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
- **Cancel**, **Escape**, or **click-outside**: discard unsaved changes and close without saving.
- When `EventEditForm` is used inside `EventCreationPopover`, `onCancel` is not passed, so the form does not show its own action buttons — the creation popover header provides Save/Cancel instead.

### Create Mode

Used for click-and-drag creation on the calendar.

#### Create-type toggle
- The creation popover shows `Event` / `Task` tabs alongside `Cancel` / `Save` buttons in a single header row.
- `Event` is the default on the first open.
- After that, the popover reopens on whichever create type the user last selected.
- The `Task` tab reuses the full inline task form, including due date, recurrence, links, and tags. Link metadata is observed only while this tab is active; late responses cannot auto-fill the hidden task form. The selected/transferred duration is preserved.
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
- Data edits are sticky: interacting with a data field counts even if you change its value back. Calendar selection is tracked separately; returning to the original calendar cancels a calendar-only move.
- Google Meet creation intent lives in the form alongside the data fields. Save builds one snapshot, including any pending Meet request.

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
  - Read directly from the query cache to derive the recurrence editor value
- The form stores only a recurrence override: inherit the series, or use explicit rules. An empty override explicitly clears recurrence. Master query updates never reset an override.
- Until the master loads, or if it errors, recurrence editing and Save are disabled. Loading and failure are shown beside the recurrence controls; failure offers Retry. Other draft fields stay intact.
- Master query identity stays the same when the editor opens and closes.
- In create mode, the hook is disabled (no event to query).

#### Move to calendar flow — Edit Mode Only
- Moving between calendars is handled via the calendar picker in the form.
- If the user changes the calendar and clicks **Save**, the save flow updates edited data first, then moves the event. A calendar-only change calls move without an update.
- Recurring moves select `all` and disable `this` / `following` in the scope dialog. The series master is moved.
- Non-recurring moves use `this`.

#### Confirmation and retry
- Save and delete share one operation: idle, confirming, running, or failed. Only one confirmation can be open.
- Cancel, Escape, and outside dismissal discard a confirmation and its command snapshot.
- While running, confirmation, scope changes, dismissal, and starting another operation are disabled. Server mutations cannot be cancelled by closing a dialog.
- Completion actions include the operation ID and step; stale completions cannot clear a newer operation or skip its next step.
- Failed operations keep the command and scope for Retry. Scope cannot change after a partial save.
- If update succeeds but move fails, Retry runs only move. If update fails, move has not started. Dismissing a failed operation keeps any changes already saved.
- Non-recurring saves run immediately; their progress and failures use the same operation dialog. Non-recurring deletes require confirmation.

#### Backend safety: partial failure recovery for `following`
- `GoogleCalendar` in `packages/google-cal/src/client.ts` implements `following` updates and moves. If the master is truncated but creating the replacement series fails, it attempts a best-effort rollback of the master's recurrence. This runs on the server; the edit UI only offers `following` for updates.
- Known backend limitation: `updateEventAll` falls back to the master's rules when given `recurrence: []`. The editor preserves and submits an explicit clear, but clearing an entire series still needs a separate backend fix.

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
- Click-outside: discards changes (no save).
- Delete: confirmation dialog for non-recurring; scope dialog for recurring.
- Cold-cache recurring instance: loading message appears, recurrence and Save stay disabled, then the inherited frequency appears when the master loads.
- Master request failure: draft remains open; Retry restores recurrence editing after recovery.
- Explicitly clear recurrence, then refetch the master: the clear remains selected.
- Calendar-only Save: one move request and no update request. Move away and back without other edits: no request.
- Change a data field and change it back: Save still sends an update.
- Add Google Meet: the save snapshot includes the pending conference request.
- Dismiss a scope confirmation with Escape/outside click, then start another: no old request runs.
- Double-click Confirm for save/delete: one operation runs; confirmation and dismissal stay disabled until it settles.
- Fail move after a successful update: Retry sends only move with the original destination and scope.

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
