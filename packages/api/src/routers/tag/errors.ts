import { Data } from "effect";

export class TagRepositoryError extends Data.TaggedError("TagRepositoryError")<{
  cause: unknown;
  message?: string;
}> {}
