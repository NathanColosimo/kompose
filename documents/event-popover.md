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
  - The editor stays open ("Saving…", fields read-only; Save keeps its width) until the save succeeds. A failure keeps it open with the edits and says so beside Save ("Couldn't save your changes. They're still here."). If the edits saved but the move to another calendar that followed didn't, it says that instead, and Save tries again.
  - A recurring event asks for the scope in a dialog over the editor. Cancel goes back to the editor with the edits; Save there holds the editor the same way.
  - A form that ends before it starts can't be saved by any path (Save, Cmd+Enter, Add Google Meet, the create popover's Save): the request is `invalid`, and the form shows "Ends before it starts."
  - The repeat is sent only when the user changed it with the Repeat control. An occurrence's pattern lives on its master, which can load after the editor opens.
- **Cancel**, **Escape**, or **click-outside**: discard unsaved changes and close without saving (not while a save runs).
- Opening an event's editor (click, or Enter on a focused block) focuses the editor itself, not its title: Tab goes into the fields, and the calendar's shortcuts stay out of it. While a save runs, and when the scope dialog closes over it, the editor keeps focus (its fields remount read-only on a save), so the calendar's keys can't navigate away from it.

### Repeat editor (web and iOS)
- Rules are read and built with `packages/state/src/google-event-recurrence.ts`, shared by both editors; the words and the monthly choices are in `packages/state/src/event-recurrence-words.ts`. The editors set frequency, interval, BYDAY, BYMONTHDAY and the end; every other part of a rule (WKST, BYMONTH...) is kept.
- Picking a frequency (`pickRecurrenceFrequency`): the same one changes nothing. A new one starts at every 1, drops the old frequency's day parts, and keeps only plain weekdays for Weekly ("2TU" isn't valid weekly).
- Monthly offers the start's day of the month ("Day 27"), its weekday of the month ("The 4th Fri"), and in its last week the last one ("The last Fri"). A rule set another way ("The last weekday", "Day 15") comes first, selected, so opening the editor never changes it. A weekday of the month replaces BYMONTHDAY; BYSETPOS goes with the BYDAY it picks from.
- "On date" ends after that day's occurrence: UNTIL is the date for an all-day series and the day's last second, in the app's time zone, for a timed one. It starts three months after the event's own day (an occurrence's, not its series' first) or today, whichever is later, and earlier dates than the event's day can't be picked (`untilDefaultDay`). A repeat the save sends whose end comes before the event's start (an end picked, then the start moved past it) can't be saved: both editors say so (`repeatEndsBeforeStart`), and the server refuses a new series that would end before it starts, before cutting the old one.
- An occurrence's save for the series sends a rule only when the user changed the repeat, or moved the day and the series' rule follows the new day, built on the series' days (`seriesRecurrenceForSave`). Otherwise the rule is left out, and the server keeps the series' own, freshly read, lined up with the new time or form, so a copy cached on the client can't write an old rule back.
- The Repeat button, its day chips and the save use one reading of the repeat (`seriesRepeatForEdit` in packages/state/src/series-edit.ts): an occurrence moved from a Wednesday to a Thursday reads "Weekly on Thu", and one moved from the 30th to the 29th "Monthly on day 29". Its implicit days count from where a save for the series starts.
- A save for an occurrence's series (This and following, Entire series), from the editor or a drop, goes through `eventForScope` (event-edit-utils.ts, over `seriesEditFields`): the event's id, its times as they are, the repeat when it sends one, and only the fields the user changed. One occurrence gets the whole edit: the occurrence as loaded, with the form's values. The server measures a series save against the occurrence as Google has it now (its `currentEvent`):
  - A field counts as changed only when it's sent and differs. Left out, or empty where the occurrence had none, it's unchanged; cleared, it goes empty and clears the series' too. Guests, a meeting and the rest left alone stay out, and the server keeps the series' own.
  - Times equal to the occurrence's own are unchanged. Entire series keeps the series' times; This and following starts the new series at the occurrence's original slot, at the series' time and length, and an occurrence moved on its own stays moved.
  - Changed times: Entire series puts the edit's form, time of day and length on the series' first day (`seriesTimesForEdit`), or moves its date through its first meeting; This and following starts the new series at the edited times.
  - An occurrence that set values of its own (moved, renamed) gets the user's change written onto it too, since Google keeps an occurrence's own values through a series change.
  - So adding a day to the repeat from a rescheduled, renamed occurrence doesn't move or rename the rest.
- The scope dialog says why each scope that's off is (`eventSaveDescription`, from #127's `EventSaveChanges`, which the editor and drops build alike with `saveFacts` in event-edit-utils.ts): a new day; a new repeat that would skip this occurrence; a new start for the series (`entireSeriesStartMoves`) of one that meets several times a day (`entireSeriesMovesSeveralADay`); This and following from the series' first meeting, which saves the whole series (`opensSeries`); or the series still loading. It turns a scope off up front only for what the series' own shape or the edit rules out; what a save would cost the series' other occurrences is the server's to refuse (next point). Its facts are worked out from the pending edit and the series as loaded now, so a series that loads after Save counts, and the series' zone is its own once loaded (`seriesTimeZone`).
- The server refuses some series writes before changing anything, with a typed reason (`SeriesRefusal`, a BAD_REQUEST whose `data` says which, read with `seriesRefusalOf`): several rules, an added occurrence, an end before the start, a count left that can't be worked out (`countUnknown`), a new time for a series that meets several times a day, a change another app's repeat can't take without losing a meeting (`otherAppRepeat`), a change to the series' start or repeat that would undo occurrences changed on their own (`dropsChangedOccurrences`), or a new length that would override theirs (`resizesChangedOccurrences`). The editor shows the reason beside Save (`refusalReason`), since a retry won't help, and asks again with that scope off and the reason leading the dialog (`refuseSave`). Every scope refused for the same save stays off, so two refusals in a row can't bring the first back. No delete is refused. A delete runs `quiet`, so a failure says "Couldn't delete it. Try again." in its dialog instead of in a toast. That dialog (`RecurringDeleteDialog`) is mounted once with the calendar, not in the event's block: a delete takes the event off the calendar as it starts, which would take the dialog along. A failed calendar move is quiet too: the editor says it beside Save.
- The client's copy of a series counts as ready only once loaded and not being fetched again after a write (pending, paused offline, or failed).
- Moving a series' start carries its days with it (`followStart`), and its skipped occurrences too (`moveSkippedDays`). In short:
  - A skip moves in its own period as the pattern did, never onto the moved meeting or a day the old pattern met on; a skip the new pattern still has stays.
  - The day the start moves to is never left skipped.
  - In a series that meets several times a day, each rule's times and skipped times stay its own.
  - Made all day, a series loses its rule times, and a timed skip becomes its date only when every meeting that day was skipped.
  - A rule the editor can't write (hourly, say) is kept as it is.
  - A weekly rule with several days keeps its set when the new start is one of them; a monthly "2nd Tue" becomes "3rd Wed", and a last stays a last in its month's last week.
  - An end date the start passed moves three months on.
  - The full rules, with examples, are the `followStart` and `moveSkippedDays` tests in `packages/state/src/google-event-recurrence.test.ts`.
  - Editing the series itself (or a new one), it applies as the start moves.
  - Moving an occurrence to another day offers "Only this occurrence" (a reschedule; the series keeps its rule) or "This and following" (a new series from the moved day, its rule following that day: `seriesRecurrenceForSave`), as Google's editor does. "Entire series" is off for a moved day, since the series keeps its first date, and "This and following" waits until the series' rule has loaded (`eventSaveDisabledScopes`).
  - An Entire series save keeps the series' first meeting and counts the rule from there, so it's off when the rule counted that way would drop this occurrence's original slot: its day (an implicit weekday or date, an interval's phase) or its end (COUNT/UNTIL) (`repeatSkipsOccurrence`, `eventSaveDisabledScopes`); the dialog says which. A calendar move (whole series only) with such a repeat offers no scope and asks for two saves.
  - "Entire series" through an occurrence keeps the series' first day. With changed times, it takes the edit's form, wall-clock time and length in the event's zone (`seriesTimesForEdit` in packages/google-cal), so a series begun before a DST change keeps its hour and an occurrence made all day makes the series all day; with times left as they were, the series keeps its own. An edit to the series itself or its first occurrence moves its date.
- A series' days (its end day, a moved start's weekday) are counted, and its edits written, in its own time zone (`seriesTimeZone`: the master's start, else the occurrence's original slot, so one rescheduled in another zone still counts the series'; the server prefers the series' zone too), since Google repeats a series in its start's zone: a Tokyo meeting edited from New York stays on Tokyo's days. When that zone isn't the app's, the repeat editor's days and choices are the series' (a Tokyo Tuesday 9:00 shown Monday evening in New York repeats on Tuesday) and it says "· Tokyo time"; the scope dialog names it too ("A new day in Tokyo time…"). If the series' rule fails to load, it says the new day applies to this occurrence only.
- A series' UNTIL and EXDATE/RDATE values always take the start's form when sent, on both apps and the server (`matchRecurrenceToStart` in packages/google-cal/src/until.ts): dates for an all-day series, date-times for a timed one (a skipped occurrence stays skipped), so toggling All day stays valid. Skipped days are read on the series' days (in its zone) and move with its start time. "This and following" starts a new series, so it's offered only at one of the rule's own meetings in a series with one rule: not at an added (RDATE) meeting (one past the rule's own end counts as added), nor in a series with several rules (only imported calendars write them), where a new start would shift the other meetings' days or phase. The scope dialog says why (`seriesSplitBlock`) and the server refuses it too (`followingSplitBlocked`). The dialog keeps This and following off until the series loads, says why when it's off, and turns Save off while the chosen scope is. Splitting a series ends the old part (never later than the rule's own end) the day before (a date) or the second before (a date-time), gives each part its own RDATE days, and carries on an unchanged COUNT with the rule positions left (`countLeft`; see "Backend safety" below). BYHOUR, BYMINUTE and BYSECOND don't change the days: Google meets a rule once a day, at the series' start time, and ignores a list of times, so a series that meets twice a day has two rules. This and following from the series' first meeting is the whole series, unless meetings were added before it: then it splits there (`followingIsWhole`, behind `opensSeries`). On the server the final rule is always lined up with the series' own start, in its zone, whatever a client sent.
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
- `CreationPreview` — Visual preview during hover/drag; a drag shows the time range it will create ("1:00 – 2:30 PM")
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
  - This and following
  - Entire series

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
- `GoogleCalendar` in `packages/google-cal/src/client.ts` implements `following` updates and moves (`splitSeries`). It creates the new series first (under an id it chooses), puts back the occurrences changed on their own, and only then cuts the old series. A failure before the cut deletes the new series. The create and the cut are tried up to twice more, after a growing wait, when Google doesn't answer, answers with a server error, or turns them away for now (a rate limit, as a 429 or a 403 that names one, or a request timeout); a create whose id is taken was made by a try whose answer was lost, and is read back. A cut that got no answer or a server error may still go through. If the cut still fails, the old series is read back: cut, the split stands; unchanged after no try that may still go through, the new series is deleted; unread, changed some other way, or unchanged after a try that may still go through, both stay and the error is returned (a meeting shown twice rather than lost). This runs on the server; the edit UI only offers `following` for updates.
- Where each later meeting lands in the new series is worked out in one place (`landingOf`): its own day at the new time, as far on as the split moved, or, for a monthly or yearly series, the meeting as many into its month or year. Changed occurrences are put back there, and deleted ones and the rule's own skips are skipped there.
- Before writing, a `following` save is refused, as `BAD_REQUEST` data saying why, when the new series couldn't keep an occurrence changed on its own (`dropsChangedOccurrences`), when the repeat it sets ends before its first meeting (`endsBeforeStart`), or when one new series can't keep a series' several rules or a meeting added off the rule's days (`severalRules`, `addedOccurrence`).
- A `following` split of a series that ends after a number of times (COUNT) carries the meetings left: its COUNT is the rule's positions from the split on (`countLeft`, read with `rrule-temporal`: skipped and deleted ones in, added days out, the series' start counted first), less those whose skip has no place of its own in the new series (none, the new start, or another's). A moved meeting's skip, where the rule still meets, takes one more place (a COUNT the user set too), and the COUNT is lowered again for each placed skip that would fall past its end. When a clock change skips the series' time on a day before the split, whether Google counted that day isn't known, so the positions before the split are read from Google's list of the series' meetings instead (each listed meeting but an added day off the rule, and each skip on a rule meeting, once). Only when that day also has a skip or an added meeting, where whether Google had a meeting can't be told, is the save refused before anything is written (`countUnknown`).
- Deleting `following` cuts each rule the second before the opened occurrence (the day before, all day); a rule that already ended keeps its end.

#### Backend safety: Entire series
- An `all` save writes only the fields the edit changed. When Google would cancel or resize occurrences changed on their own (a new start, a rule without their slot, a new length), or a deleted occurrence's skip would miss its meeting, the server refuses before writing and returns the refusal as `BAD_REQUEST` data naming them. When the opened occurrence has values of its own, the change is written to it in a second request after the series; if that one fails, the series is saved and the error returned.
- Where a series meets is read from its rules with `rrule-temporal` (`packages/google-cal/src/series.ts`, the only module that uses it), as Google reads them: a daily-or-longer rule meets once a day, at the start's time or a time part's one value, ignoring a list there. An exclusion rule (EXRULE) isn't read, so a refusal that depends on one says it may not apply (`unsure`).
- A series' recurrence is written in its start's form (`matchRecurrenceToStart`, shared with the apps): UNTIL and EXDATE/RDATE values as dates for an all-day series, date-times for a timed one; an UNTIL keeps its day, and follows the series' last meeting when a move past midnight puts that meeting on another day; a single BYHOUR moves with the start; the rule's own skips follow their meetings to a new time. A save that keeps the series' slots writes its values as they were.
- A series made in another app (meetings added outside its repeat, RDATE, or a set hour in its rule, BYHOUR/BYMINUTE) whose save changes its time of day, its form or its rule is checked day by day where it has a skip, a deleted meeting or an added one: if the write would cancel a meeting still on or bring back a skipped or deleted one, it's refused before anything is written (`otherAppRepeat`), for Entire series and This and following alike. A save that keeps every meeting as it was goes through.

#### Error feedback
- The editor's saves (`createEvent`, `updateEvent`) are held and quiet: a failure shows beside Save, with the edits kept, not as a toast.
- `moveEvent` (the calendar move) runs quiet too: the editor says beside Save that it failed, and whether the edits before it saved.
- A recurring delete runs quiet; its dialog says a refusal or failure (a polite live region) and stays open while the delete runs, its Delete button reading "Deleting…" and keeping focus.

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
