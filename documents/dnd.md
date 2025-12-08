# Calendar DnD Notes

## Overview
- DnD is powered by `@dnd-kit/core` via `CalendarDndProvider` wrapping dashboard layout.
- Supports moving and resizing for tasks and Google events with 15-minute slot granularity.
- Positioning uses `PIXELS_PER_HOUR` (80px) and 15-minute slots (20px) for layout math.

## Current structure
- DnD helpers/types: `dnd/helpers.ts`, `dnd/types.ts`, and `dnd/drop-handlers.ts` (snap/clamp math, drag shapes, payload builders).
- Provider: `dnd-context.tsx` wires sensors, preview, and mutations using shared helpers.
- Events: `events/task-event.tsx` and `events/google-event.tsx` handle render + drag/resize handles; `calendar-event.tsx` only re-exports.
- Time grid: split into `time-grid/slot-utils.ts` (slot ids/parse/hour labels), `time-slot.tsx`, `day-column.tsx`, `day-header.tsx`, `time-gutter.tsx`.
- Week view: `week-view.tsx` consumes the split components and `calculateEventPosition` for layout.

## Drag data types
- `task` / `task-resize` (`direction: start|end`).
- `google-event` / `google-event-resize` (`direction: start|end`), carrying `{ accountId, calendarId, event }`.

## Move behavior
- Body drag uses `task`/`google-event` types; drop must be on `slot-*` id (local time via `parseSlotId`).
- Duration is preserved on move (end = start + duration).

## Resize behavior
- Top/bottom handles (`cursor-n-resize` / `cursor-s-resize`) use resize data types.
- Minimum duration: 15 minutes (`MINUTES_STEP`). Resizes clamp to original day (no cross-day expansion).
- End-handle resizes snap to the bottom of the hovered slot by adding one 15-minute step for preview + mutation alignment.
- Start-handle resizes clamp to min duration and day start; end-handle resizes clamp to min duration and day end.

## Preview logic
- `handleDragOver` builds previews via `computePreviewForDrag` using slot data.
- Height = duration/60 * `PIXELS_PER_HOUR`, min 24px.
- Preview follows the same snapping/clamping rules (including end-handle +15min adjust).
- Drag overlay (title pill) is shown only for move drags; hidden during resize drags (tasks and Google events).

## Colors
- Google event colors render using a normalized pastel palette (per-account `normalizedGoogleColorsAtomFamily`), keeping hue distinctions but softening saturation/lightness for UI fit.

## Mutations
- Tasks: `orpc.tasks.update` with optimistic updates and refetch on settle.
- Google events: `orpc.googleCal.events.update` with invalidate on settle; payloads via shared builder (uses `dateTime`, clears `date`).
- Moves reuse duration; resizes recompute duration after clamping.

## Constraints & defaults
- Granularity: 15 minutes (`MINUTES_STEP`), slot list in `SLOT_MINUTES`.
- Timezone: local (slot parsing avoids UTC shift).
- Min visual height: 24px.
- Default scroll: 8am on week view mount.

## Touchpoints
- Drag start: sets active item and resize flag for overlay visibility.
- Drag over: computes preview in column coordinates to avoid scroll jitter.
- Drag end: ignores non-slot targets; applies snapping/clamping then triggers mutation.

## Known behaviors
- Resizing cannot cross midnight; dragging to edges clamps at day start/end.
- Move snapping follows slot positions; adjust `parseSlotId` / drop handling for different snap rules.
