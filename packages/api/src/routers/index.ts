import type { RouterClient } from "@orpc/server";
import { googleCalRouter } from "./google-cal/router";
import { mapsRouter } from "./maps/router";
import { tagRouter } from "./tag/router";
import { taskRouter } from "./task/router";

export const appRouter = {
  googleCal: googleCalRouter,
  maps: mapsRouter,
  tags: tagRouter,
  tasks: taskRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
