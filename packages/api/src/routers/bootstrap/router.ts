import { createRouterClient, implement, ORPCError } from "@orpc/server";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { accountRouter } from "../account/router";
import { googleCalRouter } from "../google-cal/router";
import { tagRouter } from "../tag/router";
import { taskRouter } from "../task/router";
import { bootstrapContract } from "./contract";

const os = implement(bootstrapContract).use(requireAuth).use(globalRateLimit);

function getCauseMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

const bootstrapServerRouter = {
  account: accountRouter,
  googleCal: googleCalRouter,
  tags: tagRouter,
  tasks: taskRouter,
};

function toCalendarKey(accountId: string, calendarId: string) {
  return `${accountId}:${calendarId}`;
}

export const bootstrapRouter = os.router({
  dashboard: os.dashboard.handler(async ({ input, context }) => {
    try {
      const client = createRouterClient(bootstrapServerRouter, {
        context: {
          user: context.user,
        },
      });

      // Start app-owned reads immediately while linked accounts resolve.
      const tasksPromise = client.tasks.list();
      const tagsPromise = client.tags.list();
      const linkedAccountsPromise = client.account.list();

      const [tasks, tags, linkedAccounts] = await Promise.all([
        tasksPromise,
        tagsPromise,
        linkedAccountsPromise,
      ]);

      const googleLinkedAccounts = linkedAccounts.filter(
        (account) => account.providerId === "google"
      );
      const visibleCalendarKeys =
        input.visibleCalendars && input.visibleCalendars.length > 0
          ? new Set(
              input.visibleCalendars.map((calendar) =>
                toCalendarKey(calendar.accountId, calendar.calendarId)
              )
            )
          : null;

      // Resolve each Google account independently so one broken token does not
      // block the entire bootstrap payload.
      const googleAccountData = await Promise.all(
        googleLinkedAccounts.map(async (account) => {
          try {
            const [calendars, colors] = await Promise.all([
              client.googleCal.calendars.list({
                accountId: account.accountId,
              }),
              client.googleCal.colors.list({
                accountId: account.accountId,
              }),
            ]);

            const eventsByCalendar = await Promise.all(
              calendars
                .filter((calendar) =>
                  visibleCalendarKeys?.has(
                    toCalendarKey(account.accountId, calendar.id)
                  )
                )
                .map(async (calendar) => ({
                  accountId: account.accountId,
                  calendarId: calendar.id,
                  events: await client.googleCal.events.list({
                    accountId: account.accountId,
                    calendarId: calendar.id,
                    params: {
                      timeMin: input.timeMin,
                      timeMax: input.timeMax,
                    },
                  }),
                }))
            );

            return {
              accountId: account.accountId,
              calendars,
              colors,
              eventsByCalendar,
            };
          } catch (_error) {
            return {
              accountId: account.accountId,
              calendars: [],
              colors: null,
              eventsByCalendar: [],
            };
          }
        })
      );

      return {
        googleAccounts: googleLinkedAccounts.map((account) => ({
          id: account.id,
          accountId: account.accountId,
          providerId: account.providerId,
        })),
        googleAccountProfiles: googleLinkedAccounts.map((account) => ({
          accountId: account.accountId,
          email: account.email,
          image: account.image,
          name: account.name,
        })),
        googleCalendars: googleAccountData.map((account) => ({
          accountId: account.accountId,
          calendars: account.calendars,
        })),
        googleColors: googleAccountData.flatMap((account) =>
          account.colors
            ? [{ accountId: account.accountId, colors: account.colors }]
            : []
        ),
        googleEvents: googleAccountData.flatMap(
          (account) => account.eventsByCalendar
        ),
        tasks,
        tags,
      };
    } catch (cause) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to build dashboard bootstrap payload",
        data: {
          operation: "bootstrap.dashboard",
          userId: context.user.id,
          causeMessage: getCauseMessage(cause),
        },
      });
    }
  }),
});
