import { implement, type RouterClient } from "@orpc/server";
import { accountContract } from "./account/contract";
import { aiContract } from "./ai/contract";
import { googleCalContract } from "./google-cal/contract";
import { mapsContract } from "./maps/contract";
import { syncContract } from "./sync/contract";
import { tagContract } from "./tag/contract";
import { taskContract } from "./task/contract";
import { whoopContract } from "./whoop/contract";

const appContract = {
  account: accountContract,
  ai: aiContract,
  googleCal: googleCalContract,
  maps: mapsContract,
  sync: syncContract,
  tags: tagContract,
  tasks: taskContract,
  whoop: whoopContract,
};

const app = implement(appContract);

export const appRouter = app.router({
  account: app.account.lazy(async () => ({
    default: (await import("./account/router")).accountRouter,
  })),
  ai: app.ai.lazy(async () => ({
    default: (await import("./ai/router")).aiRouter,
  })),
  googleCal: app.googleCal.lazy(async () => ({
    default: (await import("./google-cal/router")).googleCalRouter,
  })),
  maps: app.maps.lazy(async () => ({
    default: (await import("./maps/router")).mapsRouter,
  })),
  sync: app.sync.lazy(async () => ({
    default: (await import("./sync/router")).syncRouter,
  })),
  tags: app.tags.lazy(async () => ({
    default: (await import("./tag/router")).tagRouter,
  })),
  tasks: app.tasks.lazy(async () => ({
    default: (await import("./task/router")).taskRouter,
  })),
  whoop: app.whoop.lazy(async () => ({
    default: (await import("./whoop/router")).whoopRouter,
  })),
});

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
