import { oc } from "@orpc/contract";
import { z } from "zod";

export const linkedAccountSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  email: z.string(),
  name: z.string(),
});

export const listLinkedAccounts = oc
  .input(z.void())
  .output(z.array(linkedAccountSchema));

export const accountContract = {
  list: listLinkedAccounts,
};

export type LinkedAccount = z.infer<typeof linkedAccountSchema>;
