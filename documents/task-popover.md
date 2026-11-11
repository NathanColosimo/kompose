# Task Editor

The inline task editor, opened from a sidebar row or a calendar task block,
and the task side of the calendar's create popover.

## Pieces

These live in `apps/web/src/components/task-form/task-edit-popover.tsx`.

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


Triggers: `components/sidebar/task-item.tsx` (sidebar) and
`components/calendar/events/task-event.tsx` (calendar). Task queries and
mutations come from `packages/state/src/hooks/use-tasks.ts`.

## Fields

1. **Title** and **description**, placeholders only.
2. **Start date, time, duration** in one row. Clearing the start date also
   clears the time.
3. **Due date** and **Repeat**. Repeat end dates before the start are
   disabled.
5. **Links**: a card per link, and an input that takes a pasted or typed URL.
   The first link's metadata fills an empty title and the duration.
6. **Tags**.
7. **Action row** (editor only): a trash icon (tooltip "Delete", accessible
   name "Delete task"), Mark done or Mark not done, Cancel and Save. It fits
   one row of the 360px editor and wraps if the text grows.

## Saving

- Save, Mark done and task creation close the editor immediately. The shared task mutations update the cache optimistically where supported; failures roll back and use the app's normal error toast.
- Repeated submits commit only once per editor opening. The standalone Create Task dialog also closes on submit, so an old save cannot reset a reopened draft.
- Mark done includes unsaved edits in the same write, after choosing scope when needed.
- Moving or resizing the task while its editor is open updates its date, time and duration and keeps other unsaved edits.

## Repeating tasks

- Editing an occurrence of a series asks **Only this occurrence** or **This
  and following** when the edit could apply beyond it. The question and its
  default come from `getTaskUpdateScopeDecision` in
  `packages/state/src/task-recurrence.ts`, shared with iOS.
- **Mark done** with unsaved edits on a series follows the same rules, then
  saves the edits and the status in one write; the status applies to this
  occurrence only.
- **Delete** on a recurring task offers this occurrence or this and following; otherwise it asks to confirm.

## Keyboard and focus

- The editor takes focus when it opens, so Tab reaches its fields. Focus goes
  to the editor itself, not the title, so Backspace still deletes the task.
- **Cmd+Enter** saves. **Backspace** or **Delete** (outside a text field)
  asks to delete. Neither works while a question is open over the editor.
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
