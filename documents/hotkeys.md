# Hotkeys

Keyboard shortcuts for Kompose calendar. Implemented using `react-hotkeys-hook`.

## Global Hotkeys

These hotkeys work anywhere in the app, except when typing in input fields (unless noted), inside a dialog or popover (the command bar, an editor), or on a key another control already handled (arrow keys on a popover's tabs).

| Key       | Action                                 |
| --------- | -------------------------------------- |
| `⌘K`      | Open command bar (works in inputs too) |
| `c`       | New event at the next half hour today (9 AM tomorrow once today is over; else 9 AM on the first visible day); also "Create event" in the command bar. Without a Google calendar, the create popover's Event tab says why. The grid's time slots are mouse-only, so this is the keyboard and screen-reader path. |
| `1` - `7` | Set visible days count (1-7 days)      |
| `w`       | Week view (7 days)                     |
| `t`       | Go to today and switch sidebar to Today |
| `i`       | Switch sidebar to Inbox                |
| `l`       | Toggle left sidebar                    |
| `r`       | Toggle right sidebar                   |
| `s`       | Toggle both sidebars (synced)          |
| `←`       | Navigate back by visible days count    |
| `→`       | Navigate forward by visible days count |
| `Shift+←` | Navigate back 1 day                    |
| `Shift+→` | Navigate forward 1 day                 |

## Contextual Hotkeys

These hotkeys only work in specific contexts.

### Command Bar

See [command-bar.md](./command-bar.md#keyboard-navigation) for navigation within the palette.

### Creation forms

**Cmd+Enter** / **Ctrl+Enter** saves from the sidebar `CreateTaskForm` dialog and the calendar `EventCreationPopover`, including when focus is inside a form field.

### Edit Popover (Task or Event)

When an edit popover is open:

| Key                    | Action                                  |
| ---------------------- | --------------------------------------- |
| `Backspace` / `Delete` | Delete item (shows confirmation dialog) |

> **Note:** Delete hotkey is disabled when focus is on text inputs to allow normal editing.

## Implementation

- **Global hotkeys:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
- **Command bar:** `apps/web/src/components/command-bar/`
- **Task delete:** `apps/web/src/components/task-form/task-edit-popover.tsx`
- **Event delete:** `apps/web/src/components/calendar/events/event-edit-popover.tsx`

## Notes

- Global hotkeys use `enableOnFormTags: false`, except `⌘K`, which also works in inputs
- Delete hotkeys skip `<input>` and `<textarea>`; the task editor also skips `<select>`
- Mac's "delete" key maps to `backspace`, so both are registered for cross-platform support
