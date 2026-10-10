import type { Rectangle } from "electron";

export interface SavedWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export function isWindowBounds(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") {
    return false;
  }
  const bounds = value as Rectangle;
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/** Keep the whole window reachable after unplugging or resizing a display. */
export function fitWindowBounds(
  bounds: Rectangle,
  workArea: Rectangle,
  minimum: { width: number; height: number }
): Rectangle {
  const width = Math.min(
    workArea.width,
    Math.max(minimum.width, Math.round(bounds.width))
  );
  const height = Math.min(
    workArea.height,
    Math.max(minimum.height, Math.round(bounds.height))
  );
  return {
    height,
    width,
    x: Math.round(
      Math.max(
        workArea.x,
        Math.min(bounds.x, workArea.x + workArea.width - width)
      )
    ),
    y: Math.round(
      Math.max(
        workArea.y,
        Math.min(bounds.y, workArea.y + workArea.height - height)
      )
    ),
  };
}
