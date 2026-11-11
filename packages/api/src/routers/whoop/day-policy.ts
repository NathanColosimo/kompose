import type { WhoopCachedDayRaw } from "@kompose/whoop/schema";
import { Temporal } from "temporal-polyfill";

export function ttlForDay(
  payload: WhoopCachedDayRaw,
  timeZone: string
): number {
  const today = Temporal.Now.plainDateISO(timeZone).toString();
  const complete =
    payload.cycle?.end &&
    payload.recovery &&
    payload.sleeps.some((sleep) => sleep.id === payload.recovery?.sleep_id);
  const pending = [
    payload.cycle,
    payload.recovery,
    ...payload.sleeps,
    ...payload.workouts,
  ].some((record) => record?.score_state === "PENDING_SCORE");

  return payload.day < today && complete && !pending
    ? 7 * 24 * 60 * 60
    : 15 * 60;
}
