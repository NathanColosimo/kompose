# Calendar DnD Notes

## Overview

- DnD is powered by `@dnd-kit/core` via `CalendarDndProvider` wrapping dashboard layout.
- Supports moving and resizing for tasks and Google events with 15-minute slot granularity.
- Positioning uses `PIXELS_PER_HOUR` (80px) and 15-minute slots (20px) for layout math. Slots and hour-gutter rows get those heights as inline pixel styles, not rem classes like `h-5`, so the grid, event positions and drop targets stay aligned when the browser's default font size isn't 16px.
- Uses Temporal API (`ZonedDateTime`, `PlainDate`) for all date/time handling.

## Current structure

- DnD helpers/types: `dnd/helpers.ts`, `dnd/types.ts`, and `dnd/drop-handlers.ts` (snap/clamp math, drag shapes, payload builders).
- Drop targets: `dnd/day-column-slots.ts` (collision detection, the hovered-slot atom, slot to `ZonedDateTime`).
- Provider: `dnd-context.tsx` wires sensors, preview, and mutations using shared helpers.
- Events: `events/task-event.tsx` and `events/google-event.tsx` handle render + drag/resize handles.
- Time grid: `time-grid/time-slot.tsx` (click-to-create mouse handlers, grid lines), `time-grid/day-column.tsx` (column + its droppable and slot highlight), `time-grid/day-header.tsx`, `time-grid/time-gutter.tsx`, `time-grid/slot-utils.ts` (hours/minutes constants). Paths in this section are relative to `apps/web/src/components/calendar/`.

## Drop targets

Each day column registers one droppable (`day-column-<date>`), covering exactly its 96 slot buttons. The slots themselves are not droppables: registering one per slot cost ~672 droppables for a week, which dnd-kit registers in quadratic time on every navigation and re-renders on every hovered-slot change.

The slot under a drag is derived from geometry in `dnd/day-column-slots.ts`, reproducing what one droppable per slot gave:

- `calendarCollisionDetection` runs dnd-kit's own `rectIntersection`, falling back to `closestCenter`, with each column measured as the slot that would win inside it. For intersection that is the earliest slot with the most vertical overlap (the first slot the dragged rect fully covers, else the one holding its center); for the fallback, the slot holding the dragged rect's center. Columns therefore compete with the sidebar droppable as the slots did.
- The chosen slot is recorded on each column's collision as `data.slot` (`DropSlot`: `{ column, columnRect, index }`); `getDropSlot(collisions)` reads the winner's. The target follows the dragged rect (overlay or resize handle), not the pointer.
- Picking the slot in closed form ignores dnd-kit's 4-decimal rounding of intersection ratios, so a dragged edge or center within ~0.01px of a slot boundary can land on the later of the two near-tied slots, where per-slot droppables picked the earlier one.

### DayColumnDropData

```typescript
type DayColumnDropData = {
  type: "day-column";
  date: Temporal.PlainDate;
  timeZone: string;
};
```

`slotDateTime(slot)` builds the slot's wall-clock `ZonedDateTime` from `date`, the index and `timeZone`.

### DragData

- `task` / `task-resize` (`direction: start|end`).
- `google-event` / `google-event-resize` (`direction: start|end`), carrying `{ accountId, calendarId, event, start, end }`.

Google events carry `start`/`end` as `ZonedDateTime` for duration calculations during drag.

## Move behavior

- Body drag uses `task`/`google-event` types; the target time is `slotDateTime(getDropSlot(collisions))`.
- Duration is preserved on move (end = start + duration).

## Resize behavior

- Top/bottom handles (`cursor-n-resize` / `cursor-s-resize`) use resize data types.
- Minimum duration: 15 minutes (`MINUTES_STEP`). Resizes clamp to original day (no cross-day expansion).
- End-handle resizes snap to the bottom of the hovered slot by adding one 15-minute step.
- Start-handle resizes clamp to min duration and day start; end-handle resizes clamp to min duration and day end.
- `resizedRange` in `dnd/helpers.ts` does the clamping: the dragged edge stays on its own day (`edgeDay`; an end at midnight belongs to the day before, so an overnight item's end can be dragged on its second day), and a target on another day is no resize.

## Preview logic

- `handleDragMove` (dnd-kit `onDragMove`) reads the slot from the top collision and builds previews via `computePreviewForDrag`, positioned from the column rect. It skips moves whose slot and column rect are unchanged. `onDragOver` is not used, since it fires only when the hovered column changes.
- Hovered-slot highlight: `handleDragMove` writes the `DropSlot` to `dropSlotAtom`; each column renders one absolutely positioned highlight that re-renders only when its own slot changes.
- Height = duration/60 \* `PIXELS_PER_HOUR`, min 20px.
- Preview follows the same snapping/clamping rules (including end-handle +15min adjust), and is as wide as the blocks, leaving the column's free strip (`COLUMN_FREE_STRIP`).
- Drag overlay (title pill) is shown only for move drags; hidden during resize drags.

## Colors

- Google event colors render using a normalized pastel palette (per-account `normalizedGoogleColorsAtomFamily`).

## Mutations

- Tasks: `orpc.tasks.update` with optimistic updates and refetch on settle.
- Google events: `orpc.googleCal.events.update` with invalidate on settle.
- A recurring event's occurrence (moved or resized) asks for the scope first, in the shared event scope dialog (`eventSaveDisabledScopes`), as the editor does: a new day applies to this occurrence, or from it on (the rule following the new day, once the series' rule has loaded); a time-only change can also apply to the entire series. The dialog names the event and its new time ("Retro → Mon, Nov 9 · 4:00 – 4:45 PM"). The write keeps the event's own time zone (`eventTimeZone`), since Google repeats a series in its start's zone. Recurring tasks ask this-or-following in the same dialog, naming the task and its new time.
- For the series (This and following, Entire series), a drop sends only its new time and, for a moved day, the rule following it (`seriesEdit`, as the editor's save does): an occurrence renamed or rescheduled on its own keeps its title, guests and place to itself.
- Payloads built via `buildTaskMoveUpdate`, `buildTaskResizeUpdate`, `buildGoogleMoveUpdate`, `buildGoogleResizeUpdate`.
- Task payloads carry `Temporal.PlainDate` and `Temporal.PlainTime`; Google event payloads carry offset date-time strings plus `timeZone`. See [temporal.md](./temporal.md#task-scheduling) for task storage and codecs.

## Constraints & defaults

- Granularity: 15 minutes (`MINUTES_STEP`), slot list in `SLOT_MINUTES`.
- Timezone: passed through component tree, stored in `ZonedDateTime`.
- Default scroll: 7 AM on mount (`DEFAULT_SCROLL_HOUR`).
