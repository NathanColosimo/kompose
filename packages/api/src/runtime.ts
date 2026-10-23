import { DatabaseLive } from "@kompose/db";
import { Layer, ManagedRuntime } from "effect";
import { GoogleCalendarCacheService } from "./routers/google-cal/cache";
import { TagService } from "./routers/tag/client";
import { TaskService } from "./routers/task/client";
import { WhoopService } from "./routers/whoop/service";
import { LinkParserService } from "./services/link-parser/service";
import { TelemetryLive } from "./telemetry";
import { WebhookService } from "./webhooks/webhook-service";

/**
 * Every service the API serves requests with. Built once per process by
 * `appRuntime`, so layers like `DatabaseLive` (and its Postgres pool) are
 * shared across requests instead of being rebuilt by each
 * `Effect.provide(layer)` call.
 */
const AppLayer = Layer.mergeAll(
  DatabaseLive,
  GoogleCalendarCacheService.layer,
  LinkParserService.layer,
  TagService.layer,
  TaskService.layer,
  WebhookService.layer,
  WhoopService.layer,
  TelemetryLive
);

export type AppServices = Layer.Success<typeof AppLayer>;

type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

// Next dev re-evaluates modules on reload; reuse the runtime so each reload
// doesn't open another Postgres pool.
const globalForRuntime = globalThis as { komposeAppRuntime?: AppRuntime };

export const appRuntime: AppRuntime =
  globalForRuntime.komposeAppRuntime ?? ManagedRuntime.make(AppLayer);

globalForRuntime.komposeAppRuntime = appRuntime;
