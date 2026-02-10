import { Schema } from "effect";

export class AccountNotLinkedError extends Schema.TaggedError<AccountNotLinkedError>()(
  "AccountNotLinkedError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  }
) {}

/** Internal cache error — always caught and logged, never surfaces to the client. */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  operation: Schema.String,
  message: Schema.String,
}) {}
