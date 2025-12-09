# Task Edit Popover

Compact inline editor for tasks, shared by sidebar task items and calendar task events.

## Behavior
- Opens via `TaskEditPopover` wrapping a trigger element.
- Saves title, description, start date/time, and duration when the popover closes (no live autosave).
- Uses React Hook Form; values stay in sync while open.
- Updates task via `useTaskMutations().updateTask`.

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
- Task update hook: `apps/web/src/hooks/use-update-task-mutation.ts`

## Fields
- Start date: shadcn calendar, formatted `LLL dd`.
- Start time: shadcn popover with `time` input.
- Duration: numeric minutes input.
- Title / description: controlled inputs bound to form state.

## Notes
- Closing without changes does nothing; any change triggers a single update on close.
- Calendar drag/resize still works; edit popover wraps the event element. 