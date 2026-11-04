# Calendar DnD Notes

## Overview

- DnD is powered by `@dnd-kit/core` via `CalendarDndProvider` wrapping dashboard layout.
- Supports moving and resizing for tasks and Google events with 15-minute slot granularity.
- Positioning uses `PIXELS_PER_HOUR` (80px) and 15-minute slots (20px) for layout math. Slots and hour-gutter rows get those heights as inline pixel styles, not rem classes like `h-5`, so the grid, event positions and drop targets stay aligned when the browser's default font size isn't 16px.
- Uses Temporal API (`ZonedDateTime`, `PlainDate`) for all date/time handling.

## Current structure

- DnD helpers/types: `dnd/helpers.ts`, `dnd/types.ts`, and `dnd/drop-handlers.ts` (snap/clamp math, drag shapes, payload builders).
- Drop targets: `dnd/day-column-slots.ts` (collision detection and slot resolution for day columns).
- Provider: `dnd-context.tsx` wires sensors, preview, and mutations using shared helpers.
- Events: `events/task-event.tsx` and `events/google-event.tsx` handle render + drag/resize handles.
- Time grid: `time-slot.tsx` (click-to-create mouse handlers, grid lines), `day-column.tsx` (column + its droppable and slot highlight), `day-header.tsx`, `time-gutter.tsx`, `slot-utils.ts` (hours/minutes constants).

## Drop targets

Each day column registers one droppable (`day-column-<date>`), covering exactly its 96 slot buttons. The slots themselves are not droppables: registering one per slot cost ~672 droppables for a week, which dnd-kit registers in quadratic time on every navigation and re-renders on every hovered-slot change.

The slot under a drag is derived from geometry in `dnd/day-column-slots.ts`, reproducing what one droppable per slot gave:

- `calendarCollisionDetection` scores each column by its best 15-minute slot with dnd-kit's `rectIntersection` formula (dragged rect vs. slot rect, earliest slot wins ties), so columns compete with the sidebar droppable exactly as slots did. When the dragged rect overlaps nothing, it falls back to the nearest slot center, like `closestCenter`.
- `resolveDropSlot` turns a column droppable plus `active.rect.current.translated` into `{ dateTime, index, rect }`. The target follows the dragged rect (overlay or resize handle), not the pointer.

### DayColumnDropData

```typescript
type DayColumnDropData = {
  type: "day-column";
  date: Temporal.PlainDate;
  timeZone: string;
};
```

The slot `ZonedDateTime` is built from `date`, the slot index and `timeZone`.

### DragData

- `task` / `task-resize` (`direction: start|end`).
- `google-event` / `google-event-resize` (`direction: start|end`), carrying `{ accountId, calendarId, event, start, end }`.

Google events carry `start`/`end` as `ZonedDateTime` for duration calculations during drag.

## Move behavior

- Body drag uses `task`/`google-event` types; the target time comes from `resolveDropSlot`.
- Duration is preserved on move (end = start + duration).

## Resize behavior

- Top/bottom handles (`cursor-n-resize` / `cursor-s-resize`) use resize data types.
- Minimum duration: 15 minutes (`MINUTES_STEP`). Resizes clamp to original day (no cross-day expansion).
- End-handle resizes snap to the bottom of the hovered slot by adding one 15-minute step.
- Start-handle resizes clamp to min duration and day start; end-handle resizes clamp to min duration and day end.
- Clamping uses `clampResizeStart` / `clampResizeEnd` from `dnd/helpers.ts`.

## Preview logic

- `handleDragMove` (dnd-kit `onDragMove`) resolves the slot from the top collision and builds previews via `computePreviewForDrag`. It skips moves whose target slot and slot rect are unchanged. `onDragOver` is not used, since it fires only when the hovered column changes.
- Hovered-slot highlight: `handleDragMove` writes `{ dayKey, index }` to `calendarDropSlotAtom` (`state/calendar-drop-slot.ts`); each column renders one absolutely positioned highlight that re-renders only when its own slot changes.
- Height = duration/60 \* `PIXELS_PER_HOUR`, min 24px.
- Preview follows the same snapping/clamping rules (including end-handle +15min adjust).
- Drag overlay (title pill) is shown only for move drags; hidden during resize drags.

## Colors

- Google event colors render using a normalized pastel palette (per-account `normalizedGoogleColorsAtomFamily`).

## Mutations

- Tasks: `orpc.tasks.update` with optimistic updates and refetch on settle.
- Google events: `orpc.googleCal.events.update` with invalidate on settle.
- Payloads built via `buildTaskMoveUpdate`, `buildTaskResizeUpdate`, `buildGoogleMoveUpdate`, `buildGoogleResizeUpdate`.
- ISO strings for API: `zdt.toInstant().toString()`.

## Constraints & defaults

- Granularity: 15 minutes (`MINUTES_STEP`), slot list in `SLOT_MINUTES`.
- Timezone: passed through component tree, stored in `ZonedDateTime`.
- Min visual height: 24px.
- Default scroll: 8am on mount.

## Touchpoints

- Drag start: sets active item and resize flag for overlay visibility.
- Drag move: resolves the target slot, updates the highlight and preview.
- Drag end: resolves the slot from `over` (a day column) and the dragged rect, applies snapping/clamping, triggers mutation.

## Known behaviors

- Resizing cannot cross midnight; dragging to edges clamps at day start/end.
- Same-day check uses `isSameDay(a, b)` comparing `ZonedDateTime.toPlainDate()`.
