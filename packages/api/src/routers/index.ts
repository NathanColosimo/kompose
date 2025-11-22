import type { RouterClient } from "@orpc/server";
import { googleCalRouter } from "./google-cal/router";

export const appRouter = {
  googleCal: googleCalRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
