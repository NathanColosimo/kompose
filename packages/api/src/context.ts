import { auth } from "@kompose/auth";
import type { WithEffectContext } from "@orpc/effect";
import type { User } from "better-auth";
import type { NextRequest } from "next/server";
import { type AppServices, appRuntime } from "./runtime";

// used in RPCHandler in api route
export async function createContext(req: NextRequest): Promise<Context> {
  const [result, effectContext] = await Promise.all([
    auth.api.getSession({
      headers: req.headers,
    }),
    appRuntime.context(),
  ]);

  return {
    "effect/context": effectContext,
    user: result?.user,
  };
}

export interface Context extends WithEffectContext<AppServices> {
  user?: User;
}
