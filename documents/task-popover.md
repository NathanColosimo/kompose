# Task Edit Popover

Compact inline editor for tasks, shared by sidebar task items and calendar task events.

## Behavior
- Opens via `TaskEditPopover` wrapping a trigger element.
- Explicit **Save** / **Cancel** buttons at the bottom of the form.
- **Save**: validates and submits the form, then closes the popover.
- **Cancel**, **Escape**, or **click-outside**: discard unsaved changes and close without saving.
- Uses React Hook Form; values stay in sync while open.
- Updates task via `useTasks().updateTask`.

## Usage
```tsx
<TaskEditPopover task={task}>
  <Button variant="ghost">Edit</Button>
</TaskEditPopover>
```

### Where to find things
- Popover component: `apps/web/src/components/task-form/task-edit-popover.tsx`
- Sidebar trigger: `apps/web/src/components/sidebar/task-item.tsx`
- Calendar trigger: `apps/web/src/components/calendar/events/task-event.tsx`
- Task query/mutation hook: `packages/state/src/hooks/use-tasks.ts`

## Field order
1. **Title** — inline input, no label (placeholder only).
2. **Description** — inline textarea, no label.
3. Separator
4. **Start date / time / duration** — 3-column grid row (calendar scheduling).
5. **Due date / recurrence** — 2-column grid row.
6. Separator
7. **Links** — multi-link UI with `LinkMetaPreview` cards and "Add link" input. Title and duration auto-fill from first link metadata.
8. **Tags** — `TagPicker`, no label.
9. Separator
10. **Action row** (edit mode): `[Delete] ... [Cancel] [Save]` in a single row. Delete opens a confirmation dialog with scope options for recurring tasks.

## Keyboard shortcuts

See [hotkeys.md](./hotkeys.md#contextual-hotkeys) for form save and delete shortcuts.

## Notes
- Calendar drag/resize still works; edit popover wraps the event element.
- When `TaskEditForm` is used inside `EventCreationPopover` (create mode), `submitRef` lets the creation popover header submit the form; the form hides its own action buttons.
