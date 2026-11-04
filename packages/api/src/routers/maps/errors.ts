import { Schema } from "effect";
import type { PublicError } from "../../errors";

/** A Google Places request failed. `message` is for traces, not users. */
export class GoogleMapsError extends Schema.TaggedError<GoogleMapsError>()(
  "GoogleMapsError",
  {
    message: Schema.String,
  }
) {
  get publicError(): PublicError {
    return { code: "BAD_GATEWAY", message: "Place search failed. Try again." };
  }
}
