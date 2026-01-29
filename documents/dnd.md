# Calendar DnD Notes

## Overview

- DnD is powered by `@dnd-kit/core` via `CalendarDndProvider` wrapping dashboard layout.
- Supports moving and resizing for tasks and Google events with 15-minute slot granularity.
- Positioning uses `PIXELS_PER_HOUR` (80px) and 15-minute slots (20px) for layout math.
- Uses Temporal API (`ZonedDateTime`, `PlainDate`) for all date/time handling.

## Current structure

- DnD helpers/types: `dnd/helpers.ts`, `dnd/types.ts`, and `dnd/drop-handlers.ts` (snap/clamp math, drag shapes, payload builders).
- Provider: `dnd-context.tsx` wires sensors, preview, and mutations using shared helpers.
- Events: `events/task-event.tsx` and `events/google-event.tsx` handle render + drag/resize handles.
- Time grid: `time-slot.tsx`, `day-column.tsx`, `day-header.tsx`, `time-gutter.tsx`, `slot-utils.ts` (hours/minutes constants).

## Types

### SlotData

Droppable time slots pass a single `ZonedDateTime` containing all timing info:

```typescript
type SlotData = {
  dateTime: Temporal.ZonedDateTime;
};
```

This is built in `TimeSlot` and accessed directly in drop handlers - no parsing needed.

### DragData

- `task` / `task-resize` (`direction: start|end`).
- `google-event` / `google-event-resize` (`direction: start|end`), carrying `{ accountId, calendarId, event, start, end }`.

Google events carry `start`/`end` as `ZonedDateTime` for duration calculations during drag.

## Move behavior

- Body drag uses `task`/`google-event` types; drop target provides `slotData.dateTime` directly.
- Duration is preserved on move (end = start + duration).

## Resize behavior

- Top/bottom handles (`cursor-n-resize` / `cursor-s-resize`) use resize data types.
- Minimum duration: 15 minutes (`MINUTES_STEP`). Resizes clamp to original day (no cross-day expansion).
- End-handle resizes snap to the bottom of the hovered slot by adding one 15-minute step.
- Start-handle resizes clamp to min duration and day start; end-handle resizes clamp to min duration and day end.
- Clamping uses `clampResizeStart` / `clampResizeEnd` from `dnd/helpers.ts`.

## Preview logic

- `handleDragOver` builds previews via `computePreviewForDrag` using `slotData.dateTime`.
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
- Drag over: computes preview using `slotData.dateTime` for column coordinates.
- Drag end: gets `slotData` from droppable, applies snapping/clamping, triggers mutation.

## Known behaviors

- Resizing cannot cross midnight; dragging to edges clamps at day start/end.
- Same-day check uses `isSameDay(a, b)` comparing `ZonedDateTime.toPlainDate()`.
