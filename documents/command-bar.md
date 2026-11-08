# Command Bar

Unified command palette (`Cmd+K`) for quick actions in Kompose.

## Actions

| Action | Description |
| ------ | ----------- |
| Search tasks | Search open tasks by title or description. Select one to go to it and open its editor. |
| Create task | Quick task creation from free text, read by an on-device model |
| Create event | Opens the calendar's create popover, like the **c** key (shown as its shortcut); see [hotkeys.md](./hotkeys.md) for where it starts. In the in-page bar only: the desktop popup is a separate window from the calendar. |

Picking Search tasks or Create task with the mouse keeps typing in the
search field, so the page's shortcuts (such as **c**) don't take the keys.

## Search Tasks Behavior

- Searches open tasks (`status !== "done"`) that are listed on their own
  (`isListedAlone` in `packages/state/src/task-search-routing.ts`): tasks
  that don't repeat, and occurrences of a series moved to the inbox alone. A
  series' dated occurrences show on the calendar instead.
- Each result shows where it opens: the calendar (with its date), Today (or
  Tomorrow, Yesterday, a date), or Inbox.
- Selecting a task:
  - Resolves a single destination before opening anything
    (`resolveTaskSearchDestination`). Every open task has one:
    - Calendar for tasks with both `startDate` and `startTime`
    - Inbox for tasks without `startDate`, including a series occurrence
      moved there
    - Today for tasks with a start date but no start time, navigating to that date
  - If scheduled on calendar: navigates to the task's date and opens only the calendar popover
  - If routed to sidebar: switches the left sidebar to the canonical base view and opens only the sidebar popover
  - The editor scrolls its task into view as it opens and follows it, so a
    task outside the calendar's visible hours or scrolled out of the list
    still gets an editor on screen.

### Narrow windows

Below 768px an open task list fills the view and the calendar behind it is
inert (see [task-popover.md](./task-popover.md#phone-widths)). "Create
event", the **c** key, and opening a task on the calendar (from search or
the desktop popup) fold the list first, so their popovers anchor on screen.
Opening an Inbox or Today task opens that list.

## Create Task

Type the task as you'd say it: "call mom tomorrow at 4 for 30m #family",
"pay rent every month on the 1st", "standup notes https://… due fri".
A small model (`packages/task-parser`) reads the title, description, start
and due dates, time, duration, repeat, links and tags, and a preview of the
fields updates as you type. Typing `#` suggests your tags.

- The desktop popup starts loading the model on mount
  (`usePreloadTaskParser`), so it's ready by the time the command bar opens.
  The dashboard waits until its tasks and tags have loaded and no other query
  is fetching (`usePreloadTaskParserAfterData`), so the first download doesn't
  compete with the dashboard's data. Opening the command bar sooner loads it
  right away.
  The weights (14 MB, Git LFS) are kept in the Cache API between sessions.
- Parsing runs in a SharedWorker behind an oRPC contract
  (`packages/task-parser/src/worker-contract.ts`); Temporal values cross the
  worker boundary as Temporal objects. Every window and tab of a deploy
  shares one worker and one loaded model. If the worker's script can't load, its
  `error` event fails the load, and the command bar creates plain tasks.
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
- Electron creates the popup hidden at startup and keeps it loaded for quick access.
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
- **Parser worker:** `packages/task-parser/src/worker.ts`, a SharedWorker (server in `worker-server.ts`, contract in `worker-contract.ts`, client in `worker-client.ts`)
- **State atom:** `packages/state/src/atoms/command-bar.ts`
- **Hotkey registration:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
- **Desktop popup route:** `apps/web/src/app/(app)/desktop/command-bar/page.tsx`
- **Desktop shortcut settings:** `apps/web/src/app/(app)/dashboard/settings/desktop-shortcut-settings.tsx`
- **Desktop shortcut config/helpers:** `packages/desktop/src/index.ts`
