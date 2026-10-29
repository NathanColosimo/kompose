import { Schema } from "effect";

export class TagConflictError extends Schema.TaggedError<TagConflictError>()(
  "TagConflictError",
  {
    name: Schema.String,
  },
  { httpApiStatus: 409 }
) {
  override get message() {
    return `Tag name already exists: ${this.name}`;
  }
}

export class TagNotFoundError extends Schema.TaggedError<TagNotFoundError>()(
  "TagNotFoundError",
  {
    tagId: Schema.String,
  },
  { httpApiStatus: 404 }
) {
  override get message() {
    return `Tag not found: ${this.tagId}`;
  }
}

export class InvalidTagError extends Schema.TaggedError<InvalidTagError>()(
  "InvalidTagError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 }
) {}
