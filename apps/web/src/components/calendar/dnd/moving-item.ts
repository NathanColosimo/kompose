import { atom, useAtomValue } from "jotai";
import { useMemo } from "react";
import type { DragData } from "./types";

/**
 * The item being moved (not resized). Every drawn day of it hides during
 * the move, not only the part that was grabbed.
 */
export const movingItemKeyAtom = atom<string | null>(null);

export function taskItemKey(taskId: string) {
  return `task:${taskId}`;
}

export function googleItemKey(
  accountId: string,
  calendarId: string,
  eventId: string
) {
  return `google:${accountId}:${calendarId}:${eventId}`;
}

export function movingItemKey(data: DragData): string | null {
  if (data.type === "task") {
    return taskItemKey(data.task.id);
  }
  if (data.type === "google-event") {
    return googleItemKey(data.accountId, data.calendarId, data.event.id);
  }
  return null;
}

/** Whether `key`'s item is being moved; re-renders only when that changes. */
export function useIsItemMoving(key: string) {
  const isMovingAtom = useMemo(
    () => atom((get) => get(movingItemKeyAtom) === key),
    [key]
  );
  return useAtomValue(isMovingAtom);
}
