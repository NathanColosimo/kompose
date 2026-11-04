import { Schema } from "effect";
import type { PublicError } from "../../errors";

export class NonEditableGoogleEventError extends Schema.TaggedError<NonEditableGoogleEventError>()(
  "NonEditableGoogleEventError",
  {
    eventId: Schema.String,
    eventType: Schema.optional(Schema.String),
    message: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "BAD_REQUEST", message: this.message };
  }
}
