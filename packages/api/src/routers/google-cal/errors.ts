import { Schema } from "effect";

export class AccountNotLinkedError extends Schema.TaggedError<AccountNotLinkedError>()(
  "AccountNotLinkedError",
  {
    cause: Schema.Unknown,
  }
) {}
