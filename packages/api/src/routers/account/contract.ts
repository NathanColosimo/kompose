import { oc } from "@orpc/contract";
import { z } from "zod";

export const linkedAccountSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  providerId: z.string(),
});

export const listLinkedAccounts = oc
  .input(z.object({}).optional())
  .output(z.array(linkedAccountSchema));

export const accountContract = {
  list: listLinkedAccounts,
};

export type LinkedAccount = z.infer<typeof linkedAccountSchema>;
