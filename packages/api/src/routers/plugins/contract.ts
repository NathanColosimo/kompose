import { connectionSelectSchema } from "@kompose/db/schema/connection";
import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * A plugin the user connected, with the provider account's profile.
 * `accountId` is the Better Auth account row; unlinking it disconnects the plugin.
 */
const pluginConnectionSchema = connectionSelectSchema
  .pick({ accountId: true, id: true, pluginId: true, status: true })
  .extend({
    email: z.string(),
    image: z.string().nullable(),
    name: z.string(),
  });

export const pluginsContract = {
  connections: oc
    .input(z.object({}).optional())
    .output(z.array(pluginConnectionSchema)),
};

export type PluginConnection = z.infer<typeof pluginConnectionSchema>;
