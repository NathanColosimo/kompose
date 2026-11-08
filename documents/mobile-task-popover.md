# Mobile Task Popover (Sheet)

Mobile task editing uses a bottom-sheet editor shared by the Tasks tab and Calendar tab task-edit flow.

## Where to find it

- Task editor UI: `apps/native/components/tasks/task-editor-sheet.tsx`
- Tasks tab orchestration: `apps/native/app/(tabs)/(tasks)/index.tsx`
- Calendar tab task-edit orchestration: `apps/native/app/(tabs)/(calendar)/index.tsx`
- Shared editor flow: `apps/native/hooks/use-task-editor-flow.ts`
- Scope dialogs (shown over the editor): `apps/native/components/tasks/task-scope-dialogs.tsx`
- Shared task recurrence logic: `packages/state/src/task-recurrence.ts`
- Shared recurrence scope options: `packages/state/src/recurrence-scope-options.ts`

## Draft model

`TaskDraft` includes:

- `title`
- `status`
- `description`
- `tagIds`
- `durationMinutes`
- `dueDate`
- `startDate`
- `startTime`
- `recurrence`
- `links` (array of `LinkMeta` objects)
- `linkInput` (current add-link input value)

## Form layout

- Schedule row: duration, start date, start time, due date, and the Repeat
  toggle. The date, time and due chips fit their text in any locale and at
  any Dynamic Type size, and the row wraps when they don't fit one line, so
  no value truncates. In English at the default size the row fits one line
  down to a 375pt phone.
- Collapsible repeat block below the schedule row:
  - Frequency: none/daily/weekly/monthly/yearly
  - Interval
  - Weekly days
  - Monthly day-of-month
  - End mode: never/date/count
- A note under the repeat block says what a repeat change does ("Applies to
  this and later occurrences"), or why it can't save (it ends before the
  task starts).
- Title row with completion checkbox (edit mode can toggle status).
- Tags (`TaskTagPicker`).
- Description.
- Links: pressable cards with remove buttons and an "Add link" input that accepts URLs on blur. Adding a URL inserts a placeholder immediately; `tasks.parseLink` upgrades it when metadata arrives. The first link fills an empty title and replaces duration when duration metadata is available.
- The repeat and tag panels start folded on every open.

## Header actions

- Delete (edit mode) and Save in the sheet header.
- Save is off until the draft can save (`flow.canSave`): a title or a link,
  a duration, and a repeat that has occurrences. Mark done uses the same
  rule, because it saves the edits too.

## Scope dialogs

Both scope dialogs (`TaskScopeDialogs`) render inside the editor sheet
through its `overlay` prop. iOS presents a modal only from the one showing,
so a dialog beside the open sheet would never appear. Over the sheet,
Cancel (or a backdrop tap) goes straight back to the editor with the edits
kept and the done checkbox as it was.

## Save behavior

Every save holds the editor open, read-only, with "Saving…" in the header
(and on the scope dialog's Apply) until the server answers. On success
everything closes; on failure the dialog closes and the editor keeps the
edits, with the done checkbox back to its saved state. Updates to an
existing task are not optimistic: the list waits for the server rather than
showing a change it might roll back over the open draft. A new
non-recurring task does appear in the list at once (the create mutation's
optimistic row), and is removed again if the create fails.

Create:
- Calls `createTask` with current draft. A blank title falls back to the
  first link's title or host.

Edit:
- Calls `getTaskUpdateScopeDecision(...)` from `@kompose/state`.
- Decision behavior:
  - Changes to a recurring task's core fields or tags prompt for scope,
    defaulting to `this`.
  - A recurrence change applies to `following` with no prompt: one
    occurrence can't repeat differently from its series. The note under
    the repeat block says so.
  - An occurrence in the inbox (no date), or moved there by this edit, has
    nothing after it, so its edits apply to it alone.
  - Non-recurring edits apply immediately with scope `this`.
- Scoped update dialog options use shared constants:
  - Only this occurrence
  - This and following

Mark done / not done:
- With no unsaved edits, the status changes at once and the editor closes.
- With unsaved edits, they save with the status, through the scope dialog
  when the task repeats, so they're never dropped.

## Delete behavior

- Non-recurring task (or an occurrence moved to the inbox): a native alert
  confirms first, since there's no undo.
- Recurring task: the delete scope dialog opens over the editor with:
  - Only this occurrence
  - This and following

  Cancel returns to the editor.

## Quick QA checklist

- Editing a recurring task's core fields or tags prompts for update scope
  (default `this`) over the editor; Cancel returns with the edits kept.
- Changing a recurring task's repeat shows the note and saves without a
  prompt.
- Recurring delete prompts for scope over the editor; non-recurring delete
  asks for confirmation.
- Save shows "Saving…", then closes the sheet and updates the task list
  and calendar entry; a failed save keeps the editor and its edits.
- Mark done/todo from the edit sheet toggles status, saving any edits with
  it.
- At large text sizes, in another locale (German dates are longer), and on
  a 375pt phone, no schedule chip truncates.
