import type { RouterClient } from "@orpc/server";
import { aiRouter } from "./ai/router";
import { googleCalRouter } from "./google-cal/router";
import { mapsRouter } from "./maps/router";
import { syncRouter } from "./sync/router";
import { tagRouter } from "./tag/router";
import { taskRouter } from "./task/router";

export const appRouter = {
  ai: aiRouter,
  googleCal: googleCalRouter,
  maps: mapsRouter,
  sync: syncRouter,
  tags: tagRouter,
  tasks: taskRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
