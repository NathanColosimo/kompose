import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { CalendarList } from "./src/api-client/resources/users/me/calendar-list";
import { makeGoogleCalendarService } from "./src/client";

afterEach(() => {
  mock.restore();
});

test("listCalendarIds follows page tokens even when a page has no items", async () => {
  spyOn(CalendarList.prototype, "list")
    .mockResolvedValueOnce({ nextPageToken: "second-page" })
    .mockResolvedValueOnce({
      items: [{ id: "work", summary: "Work" }],
    });
  const google = makeGoogleCalendarService("test-token");

  expect(await Effect.runPromise(google.listCalendarIds())).toEqual(["work"]);
});

test("listCalendars fails instead of returning a partial list when a later page fails", async () => {
  const cause = new Error("Google request failed");
  spyOn(CalendarList.prototype, "list")
    .mockResolvedValueOnce({
      items: [{ id: "primary", summary: "Personal" }],
      nextPageToken: "second-page",
    })
    .mockRejectedValueOnce(cause);
  const google = makeGoogleCalendarService("test-token");

  const result = await Effect.runPromise(
    google
      .listCalendars()
      .pipe(Effect.catchTag("GoogleApiError", (error) => Effect.succeed(error)))
  );

  expect(result).toMatchObject({ _tag: "GoogleApiError", cause });
});

test("listCalendars validates calendars on later pages", async () => {
  spyOn(CalendarList.prototype, "list")
    .mockResolvedValueOnce({
      items: [{ id: "primary", summary: "Personal" }],
      nextPageToken: "second-page",
    })
    .mockResolvedValueOnce({ items: [{ id: "work" }] });
  const google = makeGoogleCalendarService("test-token");

  const result = await Effect.runPromise(
    google
      .listCalendars()
      .pipe(
        Effect.catchTag("GoogleCalendarZodError", (error) =>
          Effect.succeed(error)
        )
      )
  );

  expect(result).toMatchObject({ _tag: "GoogleCalendarZodError" });
});

test("listCalendars returns calendars from every page", async () => {
  const list = spyOn(CalendarList.prototype, "list")
    .mockResolvedValueOnce({
      items: [{ id: "primary", summary: "Personal" }],
      nextPageToken: "second-page",
    })
    .mockResolvedValueOnce({
      items: [{ id: "work", summary: "Work" }],
    });
  const google = makeGoogleCalendarService("test-token");

  const calendars = await Effect.runPromise(google.listCalendars());

  expect(calendars).toEqual([
    { id: "primary", summary: "Personal" },
    { id: "work", summary: "Work" },
  ]);
  expect(list).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenNthCalledWith(1, {
    maxResults: 250,
    pageToken: undefined,
  });
  expect(list).toHaveBeenNthCalledWith(2, {
    maxResults: 250,
    pageToken: "second-page",
  });
});
