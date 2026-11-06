import { implement, type RouterClient } from "@orpc/server";
import type { Context } from "../context";
import { sendPublicErrors } from "../errors";
import { agentsContract } from "./agents/contract";
import { googleCalContract } from "./google-cal/contract";
import { mapsContract } from "./maps/contract";
import { pluginsContract } from "./plugins/contract";
import { syncContract } from "./sync/contract";
import { tagContract } from "./tag/contract";
import { taskContract } from "./task/contract";
import { whoopContract } from "./whoop/contract";

const appContract = {
  agents: agentsContract,
  googleCal: googleCalContract,
  maps: mapsContract,
  plugins: pluginsContract,
  sync: syncContract,
  tags: tagContract,
  tasks: taskContract,
  whoop: whoopContract,
};

const app = implement(appContract).$context<Context>().use(sendPublicErrors);

export const appRouter = app.router({
  agents: app.agents.lazy(async () => ({
    default: (await import("./agents/router")).agentsRouter,
  })),
  googleCal: app.googleCal.lazy(async () => ({
    default: (await import("./google-cal/router")).googleCalRouter,
  })),
  maps: app.maps.lazy(async () => ({
    default: (await import("./maps/router")).mapsRouter,
  })),
  plugins: app.plugins.lazy(async () => ({
    default: (await import("./plugins/router")).pluginsRouter,
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
