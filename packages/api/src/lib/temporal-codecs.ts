import { Temporal } from "temporal-polyfill";
import z from "zod";

/**
 * Zod codec: YYYY-MM-DD string ↔ Temporal.PlainDate
 * Used for date-only fields like dueDate, startDate
 */
export const plainDateCodec = z.codec(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.custom<Temporal.PlainDate>(),
  {
    decode: (str) => Temporal.PlainDate.from(str),
    encode: (date) => date.toString(),
  }
);

/**
 * Zod codec: ISO timestamp string ↔ Temporal.Instant
 * Handles both:
 * - UTC timestamps ending in 'Z' (e.g., "2025-12-12T21:00:00Z")
 * - Postgres format with space (e.g., "2025-12-12 03:45:00")
 */
export const instantCodec = z.codec(z.string(), z.custom<Temporal.Instant>(), {
  decode: (str) => {
    // Normalize Postgres format (space) to ISO format (T)
    const normalized = str.includes("T") ? str : str.replace(" ", "T");
    // If no timezone indicator, treat as UTC
    const withTz = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
    return Temporal.Instant.from(withTz);
  },
  encode: (instant) => instant.toString(),
});

/**
 * Zod codec: local datetime string ↔ Temporal.PlainDateTime
 * For startTime stored in Postgres timestamp (without timezone).
 * Handles both ISO format (T separator) and Postgres format (space separator).
 */
export const plainDateTimeCodec = z.codec(
  z.string(),
  z.custom<Temporal.PlainDateTime>(),
  {
    decode: (str) => {
      // Normalize Postgres format (space) to ISO format (T)
      const normalized = str.includes("T") ? str : str.replace(" ", "T");
      return Temporal.PlainDateTime.from(normalized);
    },
    encode: (pdt) => pdt.toString(),
  }
);
