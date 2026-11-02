# Command Bar

Unified command palette (`Cmd+K`) for quick actions in Kompose.

## Actions

| Action | Description |
| ------ | ----------- |
| Search Tasks | Search uncompleted, non-recurring tasks by title. Select to navigate and edit. |
| Create Task | Quick task creation from free text, read by an on-device model |

## Search Tasks Behavior

- Only searches uncompleted tasks (`status !== "done"`)
- Excludes recurring tasks (no `seriesMasterId`)
- Shows location indicator: Calendar (with date) or Inbox
- Selecting a task:
  - Resolves a single destination before opening anything:
    - Calendar for tasks with both `startDate` and `startTime`
    - Inbox for tasks with neither `startDate` nor `startTime`
    - Today for non-calendar tasks that currently belong to Today sections
  - If scheduled on calendar: navigates to the task's date and opens only the calendar popover
  - If routed to sidebar: switches the left sidebar to the canonical base view and opens only the sidebar popover
  - Tasks that are searchable but not currently mounted in Calendar, Inbox, or Today are treated as deferred edge cases and keep fallback behavior for now

## Create Task

Type the task as you'd say it: "call mom tomorrow at 4 for 30m #family",
"pay rent every month on the 1st", "standup notes https://… due fri".
A small model (`packages/task-parser`) reads the title, description, start
and due dates, time, duration, repeat, links and tags, and a preview of the
fields updates as you type. Typing `#` suggests your tags.

- The dashboard and the desktop popup start loading the model on mount
  (`usePreloadTaskParser`), so it's ready by the time the command bar opens.
  The weights (14 MB, Git LFS) are kept in the Cache API between sessions.
- Parsing runs in a Web Worker behind an oRPC contract
  (`packages/task-parser/src/worker-contract.ts`); Temporal values cross the
  worker boundary as Temporal objects.
- Enter before the model has a parse waits for it.

### URL detection

The model returns the input's URLs as `links: string[]`. On task creation, `tasks.parseLink` is called for each URL to build the `links: LinkMeta[]` array. Auto-fill (title, duration) uses the first link's metadata only. Each link is displayed as a separate badge showing its provider name.

## Keyboard Navigation

| Key | Action |
| --- | ------ |
| `↑/↓` | Navigate through items |
| `↵` | Select item / create task |
| `Esc` | Go back to root view, or close |

## Desktop Global Shortcut (Electron)

- Desktop uses a dedicated `command-bar` popup window (separate from the main
  dashboard window). The popup renders the exact same `CommandBarContent`
  component used in the web dialog -- no custom scroll modes or layout
  overrides.
- Selecting a task from the dedicated popup does not try to open the task in
  the popup window. Instead it emits the same typed open request used by the
  in-page command bar, focuses the main dashboard window, and lets the main
  app route to calendar or sidebar before opening the matching popover.
- On web, the dialog shell is mounted eagerly but the heavy command-bar content
  is lazy-loaded on first open so dashboard visits do not pay for search/create
  command UI up front.
- The popup window is undecorated; on macOS it uses a rounded native HUD-style
  vibrancy treatment so the dedicated popup keeps soft corners instead of a
  square frameless shell.
- The popup auto-sizes to exactly fit the dialog content via a
  `ResizeObserver` (up to a max height of 520px).
- A global shortcut toggles the popup:
  - First press shows and focuses only the popup window.
  - Second press hides the popup.
- Clicking outside the popup hides it immediately (focus-loss hide behavior).
- Pressing Esc from a sub-view (Search/Create) returns to the root action
  list. Pressing Esc from the root view dismisses the popup. On macOS,
  dismissal restores focus to the app that was active before the popup
  opened (e.g. browser) without flickering the main Kompose window.
- Electron creates the popup on first use and releases it after 60 seconds hidden.
- Preset shortcuts in Settings: `CommandOrControl+Shift+K` (default),
  `Control+Space`, and `Alt+Space`. Electron's `globalShortcut` registers them;
  `conf` persists the selection. A failed registration preserves the old shortcut.

## Implementation

- **Main component:** `apps/web/src/components/command-bar/command-bar.tsx`
- **Shared dialog body:** `apps/web/src/components/command-bar/command-bar-content.tsx`
- **Root actions:** `apps/web/src/components/command-bar/command-bar-root.tsx`
- **Search tasks:** `apps/web/src/components/command-bar/command-bar-search-tasks.tsx`
- **Create task:** `apps/web/src/components/command-bar/command-bar-create-task.tsx`
- **Model parse hook:** `apps/web/src/lib/use-magic-task.ts`
- **Parser worker:** `packages/task-parser/src/worker.ts` (contract in `worker-contract.ts`, client in `worker-client.ts`)
- **State atom:** `packages/state/src/atoms/command-bar.ts`
- **Hotkey registration:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
- **Desktop popup route:** `apps/web/src/app/desktop/command-bar/page.tsx`
- **Desktop shortcut settings:** `apps/web/src/app/dashboard/settings/desktop-shortcut-settings.tsx`
- **Desktop shortcut config/helpers:** `packages/desktop/src/index.ts`
