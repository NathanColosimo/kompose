# Command Bar

Unified command palette (`Cmd+K`) for quick actions in Kompose.

## Actions

| Action | Description |
| ------ | ----------- |
| Search Tasks | Search uncompleted, non-recurring tasks by title. Select to navigate and edit. |
| Create Task | Quick task creation with NLP syntax for duration, due date, and start date |

## Search Tasks Behavior

- Only searches uncompleted tasks (`status !== "done"`)
- Excludes recurring tasks (no `seriesMasterId`)
- Shows location indicator: Calendar (with date) or Inbox
- Selecting a task:
  - If scheduled on calendar: navigates to the task's date
  - Opens the task edit popover automatically

## Create Task Syntax

Type a task title followed by optional modifiers:

| Symbol | Meaning | Examples |
| ------ | ------- | -------- |
| `=` | Duration | `=2h`, `=30m`, `=1h30m` |
| `>` | Due date | `>monday`, `>tomorrow`, `>jan 15` |
| `~` | Start date | `~friday`, `~next week`, `~tmrw` |

**Example:** `Read that book =2h >monday ~tomorrow`

Creates a task titled "Read that book" with 2 hour duration, due Monday, starting tomorrow.

## Keyboard Navigation

| Key | Action |
| --- | ------ |
| `↑/↓` | Navigate through items |
| `↵` | Select item / create task |
| `Esc` | Go back to root view, or close |

## Implementation

- **Main component:** `apps/web/src/components/command-bar/command-bar.tsx`
- **Root actions:** `apps/web/src/components/command-bar/command-bar-root.tsx`
- **Search tasks:** `apps/web/src/components/command-bar/command-bar-search-tasks.tsx`
- **Create task:** `apps/web/src/components/command-bar/command-bar-create-task.tsx`
- **NLP parser:** `apps/web/src/lib/task-input-parser.ts`
- **State atom:** `apps/web/src/atoms/command-bar.ts`
- **Hotkey registration:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
