import type { LinkMeta } from "@kompose/db/schema/link";
import { Schema } from "effect";

/** Identifies which provider a URL belongs to */
export type LinkProvider = LinkMeta["provider"];

export class LinkParseError extends Schema.TaggedError<LinkParseError>()(
  "LinkParseError",
  {
    url: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

const FIFTEEN_MINUTES_SECS = 900;

/** Round seconds to the nearest 15-minute increment */
export function roundToNearest15Min(seconds: number): number {
  return Math.round(seconds / FIFTEEN_MINUTES_SECS) * FIFTEEN_MINUTES_SECS;
}
