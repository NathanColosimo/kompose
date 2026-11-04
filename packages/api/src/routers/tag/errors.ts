import { Schema } from "effect";
import type { PublicError } from "../../errors";

export class TagConflictError extends Schema.TaggedError<TagConflictError>()(
  "TagConflictError",
  {
    name: Schema.String,
  }
) {
  get publicError(): PublicError {
    return {
      code: "CONFLICT",
      message: `A tag named "${this.name}" already exists.`,
    };
  }
}

export class TagNotFoundError extends Schema.TaggedError<TagNotFoundError>()(
  "TagNotFoundError",
  {
    tagId: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "NOT_FOUND", message: "Tag not found." };
  }
}

export class InvalidTagError extends Schema.TaggedError<InvalidTagError>()(
  "InvalidTagError",
  {
    message: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "BAD_REQUEST", message: this.message };
  }
}
