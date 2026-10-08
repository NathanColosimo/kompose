import type { Point, Rectangle, Size } from "electron";

export interface SavedWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Settings are user-editable JSON, so validate them before native window APIs. */
export function parsePoint(value: unknown): Point | undefined {
  const { x, y } = (value ?? {}) as Record<string, unknown>;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : undefined;
}

export function parseWindowState(value: unknown): SavedWindowState | undefined {
  const { bounds, maximized } = (value ?? {}) as Record<string, unknown>;
  const point = parsePoint(bounds);
  const { height, width } = (bounds ?? {}) as Record<string, unknown>;
  if (!(point && isFiniteNumber(width) && isFiniteNumber(height))) {
    return;
  }
  if (width <= 0 || height <= 0) {
    return;
  }
  return { bounds: { ...point, height, width }, maximized: maximized === true };
}

export function containsPoint(area: Rectangle, { x, y }: Point): boolean {
  return (
    x >= area.x &&
    y >= area.y &&
    x < area.x + area.width &&
    y < area.y + area.height
  );
}

/** Keep the whole window reachable after unplugging or resizing a display. */
export function fitWindowBounds(
  bounds: Rectangle,
  workArea: Rectangle,
  minimum: Size
): Rectangle {
  const width = Math.min(
    workArea.width,
    Math.max(minimum.width, Math.round(bounds.width))
  );
  const height = Math.min(
    workArea.height,
    Math.max(minimum.height, Math.round(bounds.height))
  );
  const clamp = (value: number, start: number, free: number) =>
    Math.round(Math.max(start, Math.min(value, start + free)));
  return {
    height,
    width,
    x: clamp(bounds.x, workArea.x, workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.height - height),
  };
}
