import { oc } from "@orpc/contract";
import { z } from "zod";

export const linkedAccountSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  providerId: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  name: z.string(),
});

export const listLinkedAccounts = oc
  .input(z.object({}).optional())
  .output(z.array(linkedAccountSchema));

export const accountContract = {
  list: listLinkedAccounts,
};

export type LinkedAccount = z.infer<typeof linkedAccountSchema>;
