# Task Editor

The inline task editor, opened from a sidebar row or a calendar task block,
and the task side of the calendar's create popover.

## Pieces

These live in `apps/web/src/components/task-form/task-edit-popover.tsx`;
`HeldFieldset` and `SaveFailure` are in `components/ui/held-fieldset.tsx`.

- **`TaskEditPopover`**: wraps a trigger (a sidebar row or a calendar block)
  and edits that task. It always has a task; creating goes through the create
  popover instead.
- **`TaskEditForm`**: the editor's form, with Delete, Mark done, Cancel and
  Save, and the scope question for a repeating task.
- **`TaskCreateForm`**: the Task tab of `EventCreationPopover`
  (`components/calendar/event-creation/event-creation-popover.tsx`). It has no
  buttons of its own: the create popover's Save calls it through `submitRef`,
  and the two tabs swap title, description, date, time and duration through
  `createInteropRef`. See [event-popover.md](./event-popover.md).
- **`TaskFields`**: the fields both forms share (below).
- **`useHeldSave`**: the held save (below). The popover that owns the editor
  calls it, `TaskEditPopover` or `EventCreationPopover`, so its Escape and
  outside-click handlers can ignore them while it saves.

Triggers: `components/sidebar/task-item.tsx` (sidebar) and
`components/calendar/events/task-event.tsx` (calendar). Task queries and
mutations come from `packages/state/src/hooks/use-tasks.ts`.

## Fields

1. **Title** and **description**, placeholders only.
2. **Start date, time, duration** in one row. Clearing the start date also
   clears the time.
3. **Due date** and **Repeat**. Repeat end dates before the start are
   disabled.
4. A note under Repeat when there's something to say: what a repeat change
   will do, or why it can't save ("The repeat ends Nov 10, before…"). While it
   blocks, the editor's Save and Mark done are disabled; the create popover's
   Save does nothing.
5. **Links**: a card per link, and an input that takes a pasted or typed URL.
   The first link's metadata fills an empty title and the duration.
6. **Tags**.
7. **Action row** (editor only): a trash icon (tooltip "Delete", accessible
   name "Delete task"), Mark done or Mark not done, Cancel and Save. It fits
   one row of the 360px editor and wraps if the text grows.

## Saving

- **Held saves.** Save, and Mark done when there are unsaved edits, keep the
  editor open with "Saving…" until the server confirms; then it closes. While
  a save holds, the fields are read-only, any open picker closes (the fields
  remount, see `HeldFieldset`), and Escape and outside clicks do nothing.
  These saves aren't optimistic, so a failure can't roll the cache back over
  the draft.
- **Failures** keep the draft and show the reason above the buttons
  (`SaveFailure`), which takes focus. The next save clears it.
- **Mark done with no other edits** saves at once and closes.
- **Save and Mark done keep their width** while they show "Saving…"
  (`SavingLabel`).
- **Moving or resizing the task** on the calendar while its editor is open
  updates the editor's date, time and duration and keeps the other unsaved
  edits, so Save can't write the old times back.
- **Create** (create popover, Task tab) holds the same way: the popover stays
  open with "Saving…", keeps the draft on failure, and shows the reason beside
  its own Save.

## Repeating tasks

- Editing an occurrence of a series asks **Only this occurrence** or **This
  and following** when the edit could apply beyond it. The question and its
  default come from `getTaskUpdateScopeDecision` in
  `packages/state/src/task-recurrence.ts`, shared with iOS.
- **A repeat change** asks no question; the note under Repeat says what it
  will do. On a dated occurrence it applies from that occurrence on. On an
  occurrence in the inbox it changes only that task: clearing Repeat takes
  it out of its series, and a new pattern makes it a series of its own.
- **Moving an occurrence to the inbox** (clearing its date) asks nothing: it
  changes that occurrence alone, as the server does.
- **Mark done** with unsaved edits on a series follows the same rules, then
  saves the edits and the status in one write; the status applies to this
  occurrence only.
- **Delete** on a dated occurrence offers this occurrence or this and
  following; otherwise it asks to confirm.

## Keyboard and focus

- The editor takes focus when it opens, so Tab reaches its fields. Focus goes
  to the editor itself, not the title, so Backspace still deletes the task.
- **Cmd+Enter** saves. **Backspace** or **Delete** (outside a text field)
  asks to delete. Neither works while a save holds or a question is open over
  the editor.
- When the scope question closes, focus returns to where the user was (the
  title after Cmd+Enter, or Save). If a save started, the fields remount, so
  focus goes to the editor instead; a save that already failed keeps focus on
  its message.
- When the delete question closes, focus returns to the editor if Backspace
  opened it, or to the trash icon if the icon did.
- Opened from command-bar search or the desktop app, the editor scrolls its
  task into view as it opens, and follows it. See
  [command-bar.md](./command-bar.md).
- The app-wide shortcuts are in [hotkeys.md](./hotkeys.md).

## Phone widths

Below 768px:

- The editor and create popover open above or below their trigger instead of
  beside it, and are at most the screen width minus 16px.
- The task panel folds to its icon rail, so the calendar gets the width. A
  rail icon opens the list full width, with a "Show calendar" button beside
  +. The calendar behind it is clipped and inert. The list folds again on
  leaving the calendar, when the command bar or the **c** key creates an
  event, and when search or the desktop app opens a task on the calendar.
  The fold doesn't change the panel choice saved for wide windows
  (`apps/web/src/state/sidebar.ts`).
