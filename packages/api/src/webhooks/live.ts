import { DatabaseLive } from "@kompose/db";
import { Layer } from "effect";
import { TelemetryLive } from "../telemetry";
import { WebhookService } from "./webhook-service";

export const WebhookLive = Layer.mergeAll(
  WebhookService.Default,
  DatabaseLive,
  TelemetryLive
);
