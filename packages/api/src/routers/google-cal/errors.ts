import { Schema } from "effect";

export class AccountNotLinkedError extends Schema.TaggedError<AccountNotLinkedError>()(
  "AccountNotLinkedError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
  }
) {}

export class NonEditableGoogleEventError extends Schema.TaggedError<NonEditableGoogleEventError>()(
  "NonEditableGoogleEventError",
  {
    eventId: Schema.String,
    eventType: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 400 }
) {}

/** Internal cache error — always caught and logged, never surfaces to the client. */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  message: Schema.String,
  operation: Schema.String,
}) {}
