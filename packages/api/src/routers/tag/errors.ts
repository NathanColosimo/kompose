import { Schema } from "effect";

export class TagRepositoryError extends Schema.TaggedError<TagRepositoryError>()(
  "TagRepositoryError",
  {
    cause: Schema.Unknown,
    message: Schema.optional(Schema.String),
  }
) {}

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

export type TagError =
  | TagRepositoryError
  | TagConflictError
  | TagNotFoundError
  | InvalidTagError;
