import { Schema } from "effect";

/** The Google Places API failed or returned a response we can't read. */
export class GoogleMapsError extends Schema.TaggedError<GoogleMapsError>()(
  "GoogleMapsError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 500 }
) {}
