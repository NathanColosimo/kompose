import { connectionStatusEnum } from "@kompose/db/schema/connection";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** A plugin the user connected, with the provider account's profile. */
const pluginConnectionSchema = z.object({
  /** The Better Auth account row; unlinking it disconnects the plugin. */
  accountId: z.string(),
  email: z.string(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  pluginId: z.string(),
  status: z.enum(connectionStatusEnum.enumValues),
});

export const pluginsContract = {
  connections: oc
    .input(z.object({}).optional())
    .output(z.array(pluginConnectionSchema)),
};

export type PluginConnection = z.infer<typeof pluginConnectionSchema>;
