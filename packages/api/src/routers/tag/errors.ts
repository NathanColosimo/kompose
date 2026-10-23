import { Schema } from "effect";

export class TagConflictError extends Schema.TaggedError<TagConflictError>()(
  "TagConflictError",
  {
    name: Schema.String,
  }
) {}

export class TagNotFoundError extends Schema.TaggedError<TagNotFoundError>()(
  "TagNotFoundError",
  {
    tagId: Schema.String,
  }
) {}

export class InvalidTagError extends Schema.TaggedError<InvalidTagError>()(
  "InvalidTagError",
  {
    message: Schema.String,
  }
) {}

export type TagError = TagConflictError | TagNotFoundError | InvalidTagError;
