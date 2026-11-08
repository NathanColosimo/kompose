/**
 * A Google event's start or end with the edited time, keeping the source's
 * other fields (its time zone) but not the date form it no longer has: an
 * occurrence made all day sends a date, not its old dateTime as well
 * (which would keep the series timed), and the reverse.
 */
export function withEditedTime<T extends { date?: string; dateTime?: string }>(
  source: T | undefined,
  edited: { date?: string; dateTime?: string; timeZone?: string }
): Omit<T, "date" | "dateTime"> & typeof edited {
  const {
    date: _date,
    dateTime: _dateTime,
    ...rest
  } = source ?? ({} as Partial<T>);
  return { ...(rest as Omit<T, "date" | "dateTime">), ...edited };
}
