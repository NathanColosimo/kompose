import { Schema } from "effect";

export class WhoopTokenUnavailableError extends Schema.TaggedError<WhoopTokenUnavailableError>()(
  "WhoopTokenUnavailableError",
  {
    accountId: Schema.String,
    cause: Schema.Unknown,
    message: Schema.String,
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
