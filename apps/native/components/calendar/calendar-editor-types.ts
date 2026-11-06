import type { CalendarIdentifier } from "@kompose/state/atoms/visible-calendars";

export type CalendarOption = CalendarIdentifier & {
  label: string;
  color?: string | null;
};
