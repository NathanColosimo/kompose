import { Schema } from "effect";

export class WhoopApiError extends Schema.TaggedError<WhoopApiError>()(
  "WhoopApiError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
    status: Schema.NullOr(Schema.Number),
  }
) {
  /** What the API sends the client; the other fields stay on the server. */
  get publicError() {
    return {
      code: "BAD_GATEWAY",
      message: "WHOOP request failed. Try again.",
    } as const;
  }
}

export class WhoopParseError extends Schema.TaggedError<WhoopParseError>()(
  "WhoopParseError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    operation: Schema.String,
  }
) {}
