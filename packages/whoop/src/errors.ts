import { Schema } from "effect";

export class WhoopApiError extends Schema.TaggedError<WhoopApiError>()(
  "WhoopApiError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
    status: Schema.NullOr(Schema.Number),
  }
) {}

export class WhoopParseError extends Schema.TaggedError<WhoopParseError>()(
  "WhoopParseError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
  }
) {}
