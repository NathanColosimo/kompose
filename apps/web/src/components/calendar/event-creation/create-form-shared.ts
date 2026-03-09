export interface CalendarCreateSharedFields {
  description: string;
  durationMinutes: number;
  startDate: Date | null;
  startTime: string;
  title: string;
}

export interface CalendarCreateFormInterop {
  applySharedFields: (fields: CalendarCreateSharedFields) => void;
  getSharedFields: () => CalendarCreateSharedFields;
}
