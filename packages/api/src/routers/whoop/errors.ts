import type { WhoopApiError, WhoopParseError } from "@kompose/whoop/errors";
import { Schema } from "effect";

export class WhoopAccountNotLinkedError extends Schema.TaggedError<WhoopAccountNotLinkedError>()(
  "WhoopAccountNotLinkedError",
  {
    accountId: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown,
  }
) {}

export class WhoopInvalidRangeError extends Schema.TaggedError<WhoopInvalidRangeError>()(
  "WhoopInvalidRangeError",
  {
    message: Schema.String,
  }
) {}

export class WhoopCacheError extends Schema.TaggedError<WhoopCacheError>()(
  "WhoopCacheError",
  {
    message: Schema.String,
    operation: Schema.String,
  }
) {}

export type WhoopError =
  | WhoopAccountNotLinkedError
  | WhoopApiError
  | WhoopInvalidRangeError
  | WhoopParseError;
