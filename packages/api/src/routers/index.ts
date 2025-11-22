import type { RouterClient } from "@orpc/server";
import { googleCalRouter } from "./google-cal/router";
import { taskRouter } from "./task/router";

export const appRouter = {
  googleCal: googleCalRouter,
  tasks: taskRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
