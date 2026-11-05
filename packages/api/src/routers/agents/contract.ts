import { oc } from "@orpc/contract";
import { z } from "zod";

/** An AI agent (MCP client) the user has authorized to use their account. */
const connectedAgentSchema = z.object({
  clientId: z.string(),
  connectedAt: z.iso.datetime(),
  icon: z.string().nullable(),
  name: z.string(),
});

export const agentsContract = {
  list: oc.input(z.object({}).optional()).output(z.array(connectedAgentSchema)),
  revoke: oc.input(z.object({ clientId: z.string() })).output(z.null()),
};
