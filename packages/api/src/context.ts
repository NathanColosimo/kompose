import { auth } from "@kompose/auth";
import type { User } from "better-auth";
import type { NextRequest } from "next/server";

// used in RPCHandler in api route
export async function createContext(req: NextRequest): Promise<Context> {
  const result = await auth.api.getSession({
    headers: req.headers,
  });

  return {
    user: result?.user,
  };
}

export interface Context {
  user?: User;
}
