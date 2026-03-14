import type { RouterClient } from "@orpc/server";
import { accountRouter } from "./account/router";
import { aiRouter } from "./ai/router";
import { bootstrapRouter } from "./bootstrap/router";
import { googleCalRouter } from "./google-cal/router";
import { mapsRouter } from "./maps/router";
import { syncRouter } from "./sync/router";
import { tagRouter } from "./tag/router";
import { taskRouter } from "./task/router";
import { whoopRouter } from "./whoop/router";

export const appRouter = {
  ai: aiRouter,
  account: accountRouter,
  bootstrap: bootstrapRouter,
  googleCal: googleCalRouter,
  maps: mapsRouter,
  sync: syncRouter,
  tags: tagRouter,
  tasks: taskRouter,
  whoop: whoopRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
