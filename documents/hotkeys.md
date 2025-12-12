# Hotkeys

Keyboard shortcuts for Kompose calendar. Implemented using `react-hotkeys-hook`.

## Global Hotkeys

These hotkeys work anywhere in the app (except when typing in input fields).

| Key | Action |
|-----|--------|
| `1` - `7` | Set visible days count (1-7 days) |
| `w` | Week view (7 days) |
| `t` | Go to today |
| `←` | Navigate back by visible days count |
| `→` | Navigate forward by visible days count |

## Contextual Hotkeys

These hotkeys only work in specific contexts.

### Edit Popover (Task or Event)

When an edit popover is open:

| Key | Action |
|-----|--------|
| `Backspace` / `Delete` | Delete item (shows confirmation dialog) |

> **Note:** Delete hotkey is disabled when focus is on text inputs to allow normal editing.

## Implementation

- **Global hotkeys:** `apps/web/src/components/hotkeys/calendar-hotkeys.tsx`
- **Task delete:** `apps/web/src/components/task-form/task-edit-popover.tsx`
- **Event delete:** `apps/web/src/components/calendar/events/event-edit-popover.tsx`

## Notes

- All global hotkeys use `enableOnFormTags: false` to prevent firing when typing in inputs
- Delete hotkey uses custom logic to skip `<input>` and `<textarea>` elements while still working on buttons and other form elements
- Mac's "delete" key maps to `backspace`, so both are registered for cross-platform support
