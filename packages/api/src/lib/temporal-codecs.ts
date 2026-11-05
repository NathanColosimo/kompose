import { Temporal } from "temporal-polyfill";
import z from "zod";

export const plainDateCodec = z.codec(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.custom<Temporal.PlainDate>(),
  {
    decode: (str) => Temporal.PlainDate.from(str),
    encode: (date) => date.toString(),
  }
);

/**
 * Temporal.PlainTime.from validates time ranges; the string schema doesn't.
 */
export const plainTimeCodec = z.codec(
  z.string(),
  z.custom<Temporal.PlainTime>(),
  {
    decode: (str) => Temporal.PlainTime.from(str),
    encode: (time) => time.toString(),
  }
);

/**
 * Accept Z-terminated timestamps and timezone-free timestamps assumed to be UTC.
 * Normalize Postgres's space separator before parsing.
 */
export const instantCodec = z.codec(z.string(), z.custom<Temporal.Instant>(), {
  decode: (str) => {
    const normalized = str.includes("T") ? str : str.replace(" ", "T");
    const withTz = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
    return Temporal.Instant.from(withTz);
  },
  encode: (instant) => instant.toString(),
});

/**
 * Accept local datetime strings with either ISO's T or Postgres's space separator.
 */
export const plainDateTimeCodec = z.codec(
  z.string(),
  z.custom<Temporal.PlainDateTime>(),
  {
    decode: (str) => {
      const normalized = str.includes("T") ? str : str.replace(" ", "T");
      return Temporal.PlainDateTime.from(normalized);
    },
    encode: (pdt) => pdt.toString(),
  }
);
