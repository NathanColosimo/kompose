import { Schema } from "effect";
// Types the `httpApiStatus` annotation.
import type {} from "effect/http-api";

export class WhoopApiError extends Schema.TaggedError<WhoopApiError>()(
  "WhoopApiError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
    status: Schema.NullOr(Schema.Number),
  },
  { httpApiStatus: 503 }
) {}

export class WhoopParseError extends Schema.TaggedError<WhoopParseError>()(
  "WhoopParseError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
  },
  { httpApiStatus: 500 }
) {}
