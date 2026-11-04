import { Schema } from "effect";
import type { PublicError } from "../../errors";

export class WhoopInvalidRangeError extends Schema.TaggedError<WhoopInvalidRangeError>()(
  "WhoopInvalidRangeError",
  {
    message: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "BAD_REQUEST", message: this.message };
  }
}

export class WhoopCacheError extends Schema.TaggedError<WhoopCacheError>()(
  "WhoopCacheError",
  {
    message: Schema.String,
    operation: Schema.String,
  }
) {}
