import { Schema } from "effect";

export class WhoopApiError extends Schema.TaggedError<WhoopApiError>()(
  "WhoopApiError",
  {
    message: Schema.String,
    operation: Schema.String,
    status: Schema.NullOr(Schema.Number),
    cause: Schema.Unknown,
  }
) {}

export class WhoopParseError extends Schema.TaggedError<WhoopParseError>()(
  "WhoopParseError",
  {
    message: Schema.String,
    operation: Schema.String,
    cause: Schema.Unknown,
  }
) {}
