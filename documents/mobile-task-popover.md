# Mobile Task Popover (Sheet)

Mobile task editing uses a bottom-sheet editor shared by the Tasks tab and Calendar tab task-edit flow.

## Where to find it

- Task editor UI: `apps/native/components/tasks/task-editor-sheet.tsx`
- Tasks tab orchestration: `apps/native/app/(tabs)/(tasks)/index.tsx`
- Calendar tab task-edit orchestration: `apps/native/app/(tabs)/(calendar)/index.tsx`
- Shared editor flow: `apps/native/hooks/use-task-editor-flow.ts`
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

- Compact schedule row: duration picker, start date, start time, due date, repeat toggle.
- Collapsible repeat block below the schedule row:
  - Frequency: none/daily/weekly/monthly/yearly
  - Interval
  - Weekly days
  - Monthly day-of-month
  - End mode: never/date/count
- Title row with completion checkbox (edit mode can toggle status).
- Tags (`TaskTagPicker`).
- Description.
- Links: pressable cards with remove buttons and an "Add link" input that accepts URLs on blur. Adding a URL inserts a placeholder immediately; `tasks.parseLink` upgrades it when metadata arrives. The first link fills an empty title and replaces duration when duration metadata is available.

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
  - Changes to recurring task core fields, tags, or recurrence prompt for scope.
  - Defaults to `this`, except recurrence changes on a non-master occurrence default to `following`.
  - Non-recurring edits apply immediately with scope `this`.
- Scoped update dialog options use shared constants:
  - Only this occurrence
  - This and following

## Delete behavior

- Non-recurring task: delete with scope `this`.
- Recurring task: opens scoped delete dialog with:
  - Only this occurrence
  - This and following

## Quick QA checklist

- Editing recurring task core fields or tags prompts for update scope (default `this`).
- Editing recurrence on recurring task supports applying to `following`.
- Recurring delete prompts for scope; non-recurring delete does not.
- Save closes sheet and updates task list/calendar entry.
- Mark done/todo toggles status correctly from edit sheet.
