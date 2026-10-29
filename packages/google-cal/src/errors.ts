import { Schema } from "effect";

export class GoogleApiError extends Schema.TaggedError<GoogleApiError>()(
  "GoogleApiError",
  {
    cause: Schema.Unknown,
  }
) {
  override get message() {
    return this.cause instanceof Error && this.cause.message
      ? `Google Calendar request failed: ${this.cause.message}`
      : "Google Calendar request failed";
  }
}

export class GoogleCalendarZodError extends Schema.TaggedError<GoogleCalendarZodError>()(
  "GoogleCalendarZodError",
  {
    cause: Schema.Unknown,
  }
) {
  override get message() {
    return "Google Calendar returned an unexpected response";
  }
}
