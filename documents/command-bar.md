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

## Desktop Global Shortcut (Tauri)

- Desktop uses a dedicated `command-bar` popup window (separate from the main
  dashboard window). The popup renders the exact same `CommandBarContent`
  component used in the web dialog -- no custom scroll modes or layout
  overrides.
- The popup window is undecorated; it auto-sizes to exactly fit the dialog
  content via a `ResizeObserver` (up to a max height of 520px).
- A global shortcut toggles the popup:
  - First press shows and focuses only the popup window.
  - Second press hides the popup.
- Clicking outside the popup hides it immediately (focus-loss hide behavior).
- Pressing Esc from a sub-view (Search/Create) returns to the root action
  list. Pressing Esc from the root view dismisses the popup. On macOS,
  dismissal restores focus to the app that was active before the popup
  opened (e.g. browser) without flickering the main Kompose window.
- The `command-bar` window must be listed in `capabilities/default.json` so
  it has access to the Tauri Store (auth bearer token), core APIs, etc.
- Preset shortcuts (selectable in Settings):
  - `CommandOrControl+K`
  - `CommandOrControl+Shift+K` (default)
  - `CommandOrControl+Space`
  - `Alt+Space`
  - `CommandOrControl+J`

## Implementation

- **Main component:** `apps/web/src/components/command-bar/command-bar.tsx`
- **Root actions:** `apps/web/src/components/command-bar/command-bar-root.tsx`
- **Search tasks:** `apps/web/src/components/command-bar/command-bar-search-tasks.tsx`
- **Create task:** `apps/web/src/components/command-bar/command-bar-create-task.tsx`
- **NLP parser:** `apps/web/src/lib/task-input-parser.ts`
- **State atom:** `packages/state/src/atoms/command-bar.ts`
- **Hotkey registration:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
- **Desktop popup route:** `apps/web/src/app/desktop/command-bar/page.tsx`
- **Desktop shortcut settings:** `apps/web/src/app/dashboard/settings/desktop-shortcut-settings.tsx`
- **Desktop shortcut config/helpers:** `apps/web/src/lib/tauri-desktop.ts`
