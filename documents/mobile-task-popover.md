# Mobile Task Popover (Sheet)

Mobile task editing uses a bottom-sheet editor shared by the Tasks tab and Calendar tab task-edit flow.

## Where to find it

- Task editor UI: `apps/native/components/tasks/task-editor-sheet.tsx`
- Tasks tab orchestration: `apps/native/app/(tabs)/(tasks)/index.tsx`
- Calendar tab task-edit orchestration: `apps/native/app/(tabs)/(calendar)/index.tsx`
- Shared task recurrence logic: `packages/state/src/task-recurrence.ts`
- Shared recurrence scope options: `packages/state/src/recurrence-scope-options.ts`

## Draft model

`TaskDraft` includes:

- `title`
- `description`
- `tagIds`
- `durationMinutes`
- `dueDate`
- `startDate`
- `startTime`
- `recurrence`

## Form sections

- Title
- Description
- Tags (`TagPicker`)
- Duration (hours/minutes picker sheet)
- Due date
- Start date
- Start time
- Repeat block:
  - Frequency: none/daily/weekly/monthly/yearly
  - Interval
  - Weekly days
  - Monthly day-of-month
  - End mode: never/date/count

## Header/footer actions

- Save action in sheet header.
- Edit mode supports:
  - Delete
  - Mark done / Mark todo

## Save behavior

Create:
- Calls `createTask` with current draft.

Edit:
- Calls `getTaskUpdateScopeDecision(...)` from `@kompose/state`.
- Decision behavior:
  - Recurring task edits prompt for scope with default `this`.
  - Recurrence rule changes still support applying to `following`.
  - Non-recurring edits apply immediately with scope `this`.
- Scoped update dialog options use shared constants:
  - Only this occurrence
  - This and following

## Delete behavior

- Non-recurring task: delete with scope `this`.
- Recurring task: opens scoped delete dialog with:
  - Only this occurrence
  - This and following

## Calendar integration behavior

When editing a scheduled task from Calendar tab:

- Opens the same `TaskEditorSheet`.
- Uses the same recurrence update/delete scope decision flow as Tasks tab.
- Uses the same shared scope labels/options from `@kompose/state`.

## Shared-state extraction summary

Task recurrence and scope behavior is centralized in `packages/state`:

- `task-recurrence.ts` (editor state, normalization, comparison, scope decision)
- `recurrence-scope-options.ts` (task update/delete scope labels)

This keeps task behavior aligned across mobile and web.

## Quick QA checklist

- Editing any recurring task fields prompts for update scope (default `this`).
- Editing recurrence on recurring task supports applying to `following`.
- Recurring delete prompts for scope; non-recurring delete does not.
- Save closes sheet and updates task list/calendar entry.
- Mark done/todo toggles status correctly from edit sheet.
